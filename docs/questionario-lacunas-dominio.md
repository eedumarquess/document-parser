# Questionario de Lacunas do Dominio

## Objetivo

Consolidar as duvidas e decisoes em aberto encontradas na leitura de:

- `docs/ddd/00-context-map.md`
- `docs/ddd/01-ingestion.md`
- `docs/ddd/02-document-processing.md`
- `docs/ddd/03-ocr-llm-extraction.md`
- `docs/ddd/04-result-delivery.md`
- `docs/ddd/05-template-management.md`
- `docs/ddd/06-audit-observability.md`
- `docs/database-schemas.md`
- `docs/plano-implementacao.md`

## Como preencher

- Preencha cada `R:` com sua resposta objetiva.
- O campo `J:` fica reservado para a justificativa da decisao que vamos estabelecer para o dominio.
- Se uma resposta depender de outra, referencie o numero do item.
- Se algo ainda estiver aberto de proposito, indique isso explicitamente.

## Questionario

### 1. Publico, autenticacao e tenancy

Quem consome o MVP na pratica? Quais papeis existem? O sistema nasce single-tenant ou multi-tenant?

R: Apenas eu, o projeto é apenas para portfolio e aprendizado, não tem cliente real. O sistema nasce single-tenant, com possibilidade de evoluir para multi-tenant no futuro.

J:

### 2. Canais de entrada e limites

No MVP teremos apenas upload multipart ou tambem outras origens? Quais MIME types, tamanho maximo e numero maximo de paginas devem ser aceitos?

R: No MVP teremos apenas upload multipart. Os MIME types aceitos serão PDF, JPEG e PNG. O tamanho máximo do arquivo será de 50MB e o número máximo de páginas será de 10.

J:

### 3. Identidade documental

Cada submissao cria um novo `Document`, ou documentos com o mesmo hash reaproveitam o mesmo registro e geram apenas novos `ProcessingJob`?

R: Documentos com o mesmo hash reaproveitam o mesmo registro e geram apenas novos `ProcessingJob`. Isso permite otimizar o processamento e evitar duplicação de esforços, além de facilitar a gestão de documentos e seus históricos de processamento.

J:

### 4. Regra oficial de idempotencia

O que define "resultado compativel" para deduplicacao? Apenas `hash`, ou `hash + requestedMode + pipelineVersion + outputVersion`, ou outra composicao?

R: A regra oficial de idempotencia para deduplicação será baseada em `hash + requestedMode + pipelineVersion + outputVersion`. Essa composição garante que não apenas o conteúdo do documento seja considerado, mas também o contexto e a configuração do processamento, evitando assim resultados incompatíveis ou inesperados ao reutilizar um resultado anterior.

J:

### 5. Comportamento em duplicidade

Quando o arquivo ja existir e `forceReprocess=false`, o sistema deve:

1. criar um novo job com `reusedResult=true`
2. devolver o job anterior
3. devolver o resultado diretamente
4. seguir outra regra

R: Quando o arquivo já existir e `forceReprocess=false`, o sistema deve criar um novo job com `reusedResult=true`. Isso permite manter um histórico claro de todas as submissões, mesmo as duplicadas, e facilita a auditoria e o rastreamento dos documentos processados, sem perder a eficiência de reutilizar resultados anteriores quando apropriado.

J:

### 6. Maquinas de estado oficiais

Precisamos fechar os estados de `Document`, `ProcessingJob` e `JobAttempt`. Em especial:

- `RECEIVED`, `VALIDATED`, `STORED` e `DEDUPLICATED` pertencem ao job mesmo?
- `REPROCESSED` deve ser tratado como estado ou apenas como evento/relacao?

R: Os estados oficiais serão: `RECEIVED`, `VALIDATED`, `STORED`, `DEDUPLICATED`, `REPROCESSED`. Os estados `RECEIVED`, `VALIDATED`, `STORED` e `DEDUPLICATED` pertencem ao `ProcessingJob`, enquanto `REPROCESSED` será tratado como um estado separado para indicar que o documento passou por um processo de reprocessamento, permitindo assim uma melhor rastreabilidade e gestão dos documentos ao longo do tempo.

J:

### 7. Fronteira entre API e worker

`orchestrator-api` e `document-processing-worker` vao compartilhar o mesmo banco no MVP, ou cada servico tera fronteira propria com integracao apenas por mensagens e contratos?

R: No MVP, `orchestrator-api` e `document-processing-worker` vão compartilhar o mesmo banco de dados. Isso simplifica a implementação inicial e permite uma integração mais direta entre os serviços, facilitando o desenvolvimento e a validação do modelo de domínio antes de considerar uma separação mais rigorosa com fronteiras próprias e integração por mensagens.

J:

### 8. Contrato da fila

Qual e o payload minimo da mensagem publicada no RabbitMQ? Alem disso, qual topologia de retry e DLQ vamos adotar no MVP?

R: O payload mínimo da mensagem publicada no RabbitMQ incluirá `documentId`, `jobId`, `attemptId`, `requestedMode`, `pipelineVersion` e um timestamp. Para a topologia de retry, adotaremos uma abordagem de retry exponencial com um máximo de 3 tentativas. Em caso de falha após as tentativas, a mensagem será encaminhada para uma Dead Letter Queue (DLQ) específica para análise posterior.
 
J:

### 9. Valores reais de `requestedMode` e `priority`

Quais valores existem no MVP para `requestedMode` e `priority`? Se houver apenas um valor inicial para cada um, vale confirmar isso para nao supermodelar cedo.

R: No MVP, o valor inicial para `requestedMode` será `STANDARD`, indicando um processamento padrão do documento. Para `priority`, o valor inicial será `NORMAL`, indicando que o documento será processado com prioridade normal. Esses valores podem ser expandidos no futuro conforme a necessidade de diferentes modos de processamento e níveis de prioridade, mas para o MVP, manteremos esses valores simples para evitar supermodelagem precoce.

J:

### 10. Escopo funcional da ficha clinica

Qual e o `payload` final esperado no MVP para ficha clinica? Sera apenas texto consolidado com marcacoes, ou ja precisamos de campos estruturados especificos? Se sim, quais campos e quais checkboxes sao obrigatorios?

R: No MVP, o `payload` final esperado para a ficha clínica será um texto consolidado com marcações, sem campos estruturados específicos. O foco inicial será na extração e consolidação do conteúdo textual, permitindo uma validação mais rápida do modelo de processamento. Campos estruturados e checkboxes obrigatórios poderão ser considerados em versões futuras, dependendo dos resultados e feedbacks obtidos com o MVP.

J:

### 11. Semantica de `PARTIAL`

Quando um resultado deve ser `PARTIAL` em vez de `FAILED` ou `COMPLETED`?

R: Um resultado deve ser classificado como `PARTIAL` quando o processamento do documento foi concluído, mas algumas partes do conteúdo não puderam ser extraídas ou processadas corretamente, resultando em um resultado incompleto. Isso pode ocorrer, por exemplo, quando há baixa qualidade de imagem, campos manuscritos ilegíveis ou informações críticas ausentes. O status `PARTIAL` indica que o resultado é utilizável, mas pode exigir revisão manual ou reprocessamento para obter um resultado completo.

J:

### 12. Heuristicas de fallback

O que dispara fallback para LLM? Exemplo: OCR vazio, baixa confianca global, manuscrito detectado, checkbox ambiguo, campos criticos ausentes. O fallback ocorre por documento, pagina, bloco ou campo?

R: O fallback para LLM será disparado por heurísticas como OCR vazio, baixa confiança global, detecção de manuscrito, checkbox ambíguo ou campos críticos ausentes. O fallback ocorrerá a nível de campo, permitindo uma abordagem mais granular e eficiente para lidar com casos específicos onde o OCR tradicional pode falhar, sem comprometer o processamento de todo o documento.

J:

### 13. LLM externo e dados sensiveis

Qual provedor/modelo voce imagina inicialmente? Qual politica de protecao e aceitavel para envio de dados sensiveis: mascaramento, pseudonimizacao, recorte por regiao, proibicao para certos dados, outra?

R: Openrouter, huggingface, algo que seja gratuito ou tenha um free tier generoso, ja que o objetivo é aprendizado e portfolio. A politica de protecao para envio de dados sensiveis sera o mascaramento, onde informações identificáveis serão substituídas por placeholders antes de serem enviadas para o LLM, garantindo assim a privacidade dos dados enquanto ainda permite a extração de informações relevantes.

J:

### 14. Artefatos obrigatorios

Quais artefatos precisam ser persistidos no MVP? Exemplo: original, render por pagina, OCR bruto, texto mascarado enviado ao LLM, prompt/resposta, recortes de manuscrito. Algum deles nao pode ser persistido?

R: No MVP, os artefatos obrigatórios a serem persistidos incluem o arquivo original, o render por página, o OCR bruto e o texto mascarado enviado ao LLM. O prompt e resposta do LLM também serão armazenados para fins de auditoria e melhoria contínua do modelo. Recortes de manuscrito podem ser considerados para persistência em versões futuras, dependendo da complexidade e do volume de dados, mas inicialmente não serão obrigatórios para evitar sobrecarga de armazenamento.

J:

### 15. Contrato do endpoint de resultado

Qual deve ser exatamente o shape do `GET /v1/parsing/jobs/{jobId}/result`? Precisamos expor `hash`, `pageSummaries`, confianca por campo, links temporarios de artefatos, ou apenas `payload` final com metadados minimos?

R: O contrato do endpoint `GET /v1/parsing/jobs/{jobId}/result` deve incluir o `payload` final com os metadados mínimos, como `status`, `requestedMode`, `pipelineVersion`, `outputVersion`, e um campo de `confidence` geral. Links temporários para artefatos podem ser incluídos opcionalmente, mas não serão obrigatórios no MVP para simplificar a implementação inicial. O foco será fornecer um resultado consolidado e fácil de consumir, sem expor detalhes técnicos desnecessários para o usuário final.

J:

### 16. Versionamento tecnico

Como vamos versionar `outputVersion`, `pipelineVersion`, `normalizationVersion`, `promptVersion` e `modelVersion`? SemVer manual, Git SHA, data/hora, outra estrategia?

R: Vamos adotar uma estratégia de versionamento baseada em Git SHA para `pipelineVersion`, `normalizationVersion`, `promptVersion` e `modelVersion`, garantindo uma rastreabilidade clara e precisa das mudanças no código e nos modelos. Para `outputVersion`, utilizaremos um formato SemVer manual, permitindo uma comunicação mais amigável sobre as mudanças e melhorias nos resultados entregues, facilitando a compreensão por parte dos usuários e stakeholders.

J:

### 17. Regra de reprocessamento

Quem pode reprocessar, por quais motivos e com qual efeito esperado? O reprocessamento cria um novo job apontando para o mesmo `documentId`, preservando todos os resultados anteriores, ou existe algum conceito de "resultado ativo" substituivel?

R: O reprocessamento pode ser acionado por usuários autorizados, como administradores ou operadores, e pode ocorrer por motivos como melhoria de qualidade, correção de erros ou atualização de modelos. O reprocessamento criará um novo job apontando para o mesmo `documentId`, preservando todos os resultados anteriores para fins de auditoria e comparação, sem substituir diretamente um "resultado ativo". Isso permite uma gestão mais transparente dos documentos e seus históricos de processamento, além de facilitar a análise de melhorias ao longo do tempo.

J:

### 18. Papel de Template Management no MVP

Voce quer deixar `templateId`, `templateStatus` e pontos de extensao ja previstos no contrato e schema do MVP, mesmo sem ativar templates, ou prefere manter isso totalmente fora por enquanto?

R: Prefiro manter `templateId`, `templateStatus` e pontos de extensão totalmente fora do contrato e schema do MVP por enquanto. Isso evita a complexidade adicional de gerenciar templates em uma fase inicial, permitindo que o foco seja na validação do modelo de processamento e na entrega de resultados consistentes. A introdução de templates pode ser considerada em versões futuras, uma vez que tenhamos uma base sólida e compreendamos melhor as necessidades dos usuários e os casos de uso específicos.

J:

### 19. Taxonomia de erros

Ja existe convencao para `errorCode`? Se nao, podemos definir uma primeira taxonomia cobrindo validacao de entrada, autorizacao, nao encontrado, falhas transitorias, falhas terminais, timeout, DLQ e reprocessamento.

R: Atualmente, não existe uma convenção definida para `errorCode`. Podemos definir uma primeira taxonomia que inclua categorias como `VALIDATION_ERROR`, `AUTHORIZATION_ERROR`, `NOT_FOUND`, `TRANSIENT_FAILURE`, `FATAL_FAILURE`, `TIMEOUT`, `DLQ_ERROR` e `REPROCESSING_ERROR`. Essa taxonomia permitirá uma classificação clara dos erros, facilitando a identificação de problemas e a implementação de estratégias de mitigação adequadas para cada tipo de erro.

J:

### 20. Retencao, auditoria e purge

Qual politica de retencao vale para original, artefatos, OCR bruto, resultado final, eventos de auditoria e DLQ? Quais leituras e operacoes precisam gerar auditoria no MVP?

R: A política de retenção para o MVP será a seguinte: o arquivo original e os artefatos serão retidos por 30 dias, o OCR bruto e o resultado final serão retidos por 90 dias, e os eventos de auditoria e mensagens na DLQ serão retidos por 180 dias. As leituras e operações que precisam gerar auditoria incluem submissões de documentos, acessos aos resultados, reprocessamentos e falhas críticas, garantindo assim uma trilha de auditoria completa para monitoramento e análise de uso do sistema.

J:

### 21. Golden dataset e criterio de aceite

Como sera definido o dataset inicial e o criterio objetivo de qualidade? Quantidade aproximada de documentos, origem do ground truth, metricas principais e forma de validar o SLA de ate 30 segundos.

R: O dataset inicial será composto por aproximadamente 100 documentos, selecionados de fontes públicas e anonimizados para garantir a privacidade. O ground truth será definido por meio de anotações manuais realizadas por especialistas, garantindo a precisão dos dados. As métricas principais para avaliação incluirão precisão, recall e F1-score, além do tempo de processamento para validar o SLA de até 30 segundos. A validação do SLA será realizada por meio de testes automatizados que simulem cargas reais e monitoramento contínuo durante a fase de MVP para garantir que os objetivos de desempenho sejam atendidos.

J:
