# DDD: Template Management

## Objetivo

Manter explicita a ausencia de um contexto de templates ativo no MVP e evitar que conceitos ja implementados no codigo, como `compatibilityKey` e heuristicas de extracao, sejam confundidos com classificacao por template.

## Estado atual no codigo

`Template Management` continua fora do contrato externo, fora do schema persistido e fora do fluxo obrigatorio de processamento.

Hoje nao existe no repositorio:

- `templateId` em `Document`, `ProcessingJob`, `JobAttempt`, `ProcessingResult` ou mensagem de fila
- `templateVersion`, `templateStatus` ou `matchingRules` em contratos publicos
- colecao `templates`, `template_versions` ou equivalente no `MongoDB`
- caso de uso administrativo para cadastrar, publicar, desativar ou classificar templates
- etapa de classificacao por template antes da extracao no worker

As colecoes persistidas no estado atual continuam sendo:

- `documents`
- `processing_jobs`
- `job_attempts`
- `processing_results`
- `page_artifacts`
- `audit_events`
- `dead_letter_events`

## O que existe hoje no lugar de templates

### `CompatibilityKey`

O conceito implementado mais proximo de uma "chave de compatibilidade" e `CompatibilityKey`, presente nos dois servicos.

Regra oficial atual:

- `compatibilityKey = hash + requestedMode + pipelineVersion + outputVersion`

Papel real no sistema:

- o `orchestrator-api` calcula a chave antes de criar um novo job
- `CompatibleResultLookupPort` procura um `ProcessingResult` compativel por essa chave
- quando encontra um resultado compativel e `forceReprocess = false`, o fluxo cria um job deduplicado e reaproveita o resultado
- o worker persiste essa mesma chave em `ProcessingResultRecord`
- o `MongoDB` indexa `processing_results.compatibilityKey`

O que `CompatibilityKey` nao e:

- nao e identificador de layout
- nao e classificador de tipo documental
- nao representa versao de template
- nao guarda regras de campos ou checkboxes

### Heuristicas genericas da pipeline

O worker ja possui regras internas de extracao, mas elas ainda nao caracterizam um contexto de templates.

Capacidades implementadas:

- `TextNormalizationService` normaliza marcadores tecnicos e prepara texto legivel por pagina
- `HeuristicEvaluationService` detecta `handwrittenSegments`, `checkboxFindings` e `criticalFieldFindings`
- `TextConsolidationService` mescla respostas de fallback no texto consolidado
- `ProcessingOutcomePolicy` decide entre `COMPLETED` e `PARTIAL`

Essas heuristicas sao:

- genericas
- acopladas a uma `pipelineVersion`
- executadas por tentativa
- internas ao contexto de `OCR/LLM Extraction`

Essas heuristicas nao sao:

- configuradas por usuario
- publicadas como versoes administrativas
- reutilizadas como cadastro canonicamente persistido
- selecionadas por um motor de matching de template

## Fronteira arquitetural atual

### `orchestrator-api`

Responsabilidades reais relacionadas a compatibilidade:

- calcular `hash`
- montar `compatibilityKey`
- consultar `ProcessingResult` compativel
- decidir reuso via `CompatibleResultReusePolicy`
- auditar `COMPATIBLE_RESULT_REUSED` quando houver deduplicacao

### `document-processing-worker`

Responsabilidades reais relacionadas ao processamento:

- consumir a fila
- carregar `Document`, `ProcessingJob` e `JobAttempt`
- executar a pipeline generica de `OCR -> heuristicas -> fallback LLM -> consolidacao`
- persistir `ProcessingResult` com `compatibilityKey`

### Fora do escopo atual

Continua sem dono implementado:

- CRUD de templates
- publicacao de versoes de template
- classificacao de documento por catalogo conhecido
- mapeamento administravel de campos por dominio documental

## Regras de negocio atuais

- O processamento continua generico e independe de template.
- Nenhum adapter ou caso de uso pode assumir `templateId` como pre-condicao.
- O reuso de resultado depende apenas de `compatibilityKey` e de `forceReprocess`.
- `criticalFieldFindings` pertencem a heuristicas internas de fallback, nao a um cadastro canonico de campos por template.
- A pipeline atual pode evoluir em heuristicas e fallback sem introduzir schema de template.

## Regras de anti-acoplamento

- nao sobrecarregar `compatibilityKey` com semantica de template
- nao persistir `templateId` em agregados atuais sem abrir um contexto proprio
- nao espalhar regras de matching futuro dentro dos adapters do worker
- nao promover `criticalFieldFindings` ou `checkboxFindings` a definicoes administrativas sem versionamento explicito

## Ativacao futura do contexto

Quando `Template Management` for ativado de verdade, ele deve nascer como um contexto proprio e nao como extensao opportunista do fluxo atual.

Capacidades minimas esperadas para a ativacao:

- `TemplateDefinition` versionado
- regras de matching explicitamente persistidas
- definicoes de campos e checkboxes por versao
- classificacao auditavel
- fallback para pipeline generica quando a classificacao for inconclusiva

Portas provaveis para uma fase futura:

### Entrada

- `CreateTemplateCommand`
- `PublishTemplateVersionCommand`
- `ClassifyDocumentByTemplateCommand`

### Saida

- `TemplateRepositoryPort`
- `TemplateArtifactStoragePort`

## Criterio atual de consistencia arquitetural

Enquanto este contexto continuar inativo, a documentacao so estara alinhada ao codigo quando todos os itens abaixo forem verdadeiros:

- nao houver `templateId` nos contratos e modelos atuais
- a deduplicacao continuar baseada em `compatibilityKey`
- a extracao continuar generica e sem catalogo de templates
- as heuristicas internas do worker nao forem tratadas como cadastro administrativo
- qualquer evolucao futura de template entrar por um bounded context proprio
