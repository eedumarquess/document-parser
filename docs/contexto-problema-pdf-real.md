# Contexto do problema: PDF real gera milhares de paginas/artefatos no contexto operacional

## Data e contexto

- Data da observacao: 2026-04-02
- Ambiente: execucao local com API em `http://localhost:3000`
- Arquivo usado no teste manual: `C:\Users\eduar\Downloads\debito_20260331.pdf`

## Resumo executivo

Ao enviar um PDF real para `POST /v1/parsing/jobs`, o job foi aceito e processado, mas o resultado operacional ficou claramente incorreto:

- o job terminou como `PARTIAL`
- o endpoint `GET /v1/ops/jobs/:jobId/context` retornou milhares de artefatos
- varios artefatos apareceram com `pageNumber` na faixa de `2588` ate `2716+`
- `previewText` de varios artefatos `OCR_JSON` continha lixo binario, trechos de PDF e sequencias como `endstream`, `FlateDecode` e bytes quebrados

Conclusao inicial: o endpoint operacional esta funcionando como desenhado no sentido de devolver muito contexto, mas o pipeline de PDF real esta interpretando o arquivo de forma errada e fabricando paginas/artefatos demais.

## Reproducao usada

### 1. Envio do documento

```powershell
curl.exe -X POST http://localhost:3000/v1/parsing/jobs `
  -H "x-role: OWNER" `
  -H "x-trace-id: manual-test-1" `
  -F 'file=@C:\Users\eduar\Downloads\debito_20260331.pdf;type=application/pdf'
```

### 2. Job criado

- Job original: `job-854b4a75-38c6-43cc-8a5f-eedf169cb285`
- DocumentId: `doc-674cc1e9-18ba-4de7-b315-04910585c14e`
- Trace principal do submit: `manual-test-1`

### 3. Consulta do contexto operacional

```powershell
curl.exe http://localhost:3000/v1/ops/jobs/job-854b4a75-38c6-43cc-8a5f-eedf169cb285/context `
  -H "x-role: OPERATOR"
```

### 4. Reprocessamento manual

```powershell
curl.exe -X POST "http://localhost:3000/v1/parsing/jobs/job-854b4a75-38c6-43cc-8a5f-eedf169cb285/reprocess" `
  -H "x-role: OWNER" `
  -H "Content-Type: application/json" `
  -d '{"reason":"reteste manual"}'
```

- Job de reprocessamento: `job-266c9297-ca45-42b9-9766-90e2abf7f940`
- O reprocessamento tambem terminou em `PARTIAL`

## Sintomas observados

- `GET /v1/ops/jobs/:jobId/context` devolveu `summary`, `attempts`, `result`, `artifacts`, `telemetryEvents`, `timeline` etc., tudo em uma resposta grande
- isso por si so e esperado, porque o endpoint agrega todo o contexto operacional do job
- o problema real e que a lista de `artifacts` ficou desproporcional
- os `OCR_JSON` exibiram `previewText` com bytes corrompidos e fragmentos do PDF em vez de texto OCR legivel
- o resultado final ficou com:
  - `status: PARTIAL`
  - `engineUsed: OCR+LLM`
  - `confidence` muito baixa

Exemplos do comportamento ruim:

- `pageNumber: 2588`, `2599`, `2716`
- `previewText` contendo lixo como `endstream endobj`, `FlateDecode` e bytes quebrados

## O que parece estar acontecendo

Hipotese tecnica inicial:

1. O contador de paginas do orchestrator trata PDF como texto UTF-8 e conta ocorrencias de `"/Type /Page"` no buffer cru.
2. O renderer do worker tambem transforma o PDF bruto em texto UTF-8.
3. Em PDF binario real, isso pode gerar contagem absurda de paginas, chunks falsos e OCR em cima de bytes do proprio PDF.
4. O contexto operacional so esta refletindo esse estado ruim, por isso a resposta fica enorme e cheia de artefatos invalidos.

## Arquivos mais suspeitos

### Contagem de paginas no orchestrator

Arquivo: `apps/orchestrator-api/src/adapters/out/storage/simple-page-counter.adapter.ts`

Comportamento atual:

- para PDF, faz `file.buffer.toString('utf8')`
- conta `raw.match(/\/Type\s*\/Page\b/g)`

Risco:

- PDF real pode conter esse padrao em varios lugares que nao representam paginas reais

### Renderizacao de paginas no worker

Arquivo: `apps/document-processing-worker/src/adapters/out/extraction/default-page-renderer.adapter.ts`

Comportamento atual:

- faz `input.original.toString('utf8')`
- divide por `[[PAGE_BREAK]]` ou `\f`
- define `pageTotal = Math.max(1, input.pageCount, chunks.length)`

Risco:

- se `pageCount` vier inflado, o worker fabrica milhares de paginas vazias ou com texto corrompido
- se `chunks.length` crescer por leitura indevida do binario, o problema piora

### Preview de artefatos operacionais

Arquivo: `apps/orchestrator-api/src/application/services/artifact-preview.service.ts`

Comportamento atual:

- para `OCR_JSON`, o preview vem de `metadata.rawText` ou `metadata.rawPayload`
- se o OCR recebeu lixo, o preview replica esse lixo no endpoint operacional

## Por que os testes atuais nao pegaram isso

Os testes e2e e contratos atuais usam buffers simplificados que imitam PDF como texto, por exemplo algo na linha de:

```txt
%PDF-1.4
/Type /Page
conteudo
```

Isso explica por que a suite passa e o problema aparece so com PDF binario real.

## Impacto pratico

- o endpoint operacional fica pesado demais para uso manual
- o resultado do processamento perde confiabilidade para PDF real
- o sistema pode persistir uma quantidade exagerada de artefatos sem valor
- reprocessamento nao corrige o problema porque reutiliza a mesma estrategia de leitura

## Direcao de investigacao recomendada

1. Parar de contar paginas de PDF via regex em buffer UTF-8 cru.
2. Parar de tratar PDF binario como texto no renderer default.
3. Se nao houver renderer real de PDF ainda, falhar explicitamente ou limitar o comportamento para nao fabricar milhares de paginas.
4. Adicionar teste com um PDF binario real pequeno no repositorio ou fixture dedicada.
5. Avaliar limitar ou paginar `artifacts`, `telemetryEvents` e `timeline` no endpoint operacional.
6. Avaliar suprimir `previewText` quando o conteudo nao for claramente texto legivel.

## Criterio de sucesso para a correcao

- um PDF real de poucas paginas nao pode gerar milhares de paginas ou artefatos
- `pageNumber` deve refletir o numero real de paginas
- `previewText` nao deve expor bytes binarios ou fragmentos estruturais do PDF
- o endpoint operacional pode continuar verboso, mas precisa refletir dados validos
- testes automatizados devem cobrir ao menos um PDF binario real

## Pergunta objetiva para a proxima conversa

"Como corrigir o pipeline para que PDFs binarios reais nao sejam tratados como texto UTF-8, evitando contagem falsa de paginas, milhares de artefatos e `previewText` com lixo binario no endpoint `/v1/ops/jobs/:jobId/context`?"
