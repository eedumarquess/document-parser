# DDD: Template Management

## Objetivo

Manter uma fronteira explicita para classificacao e extracao guiadas por template sem contaminar o MVP com complexidade prematura.

## Decisao oficial para o MVP

`Template Management` fica totalmente fora do contrato e do schema do MVP.

Isso significa:

- nao existe `templateId` no contrato externo inicial
- nao existe `templateStatus` no contrato externo inicial
- nao existe colecao obrigatoria de template no schema do MVP
- `Ingestion`, `Document Processing` e `Result Delivery` nao dependem de template para funcionar

## Papel arquitetural agora

Mesmo fora do MVP, o subdominio continua documentado para evitar acoplamento indevido:

- a pipeline atual deve continuar generica
- nenhuma regra do worker pode assumir template fixo como pre-condicao
- qualquer evolucao futura de template deve entrar por contexto proprio

## Agregado futuro `TemplateDefinition`

Quando o contexto for ativado, ele deve conter pelo menos:

- `templateId`
- `name`
- `documentDomain`
- `version`
- `status`
- `matchingRules`
- `fieldDefinitions`
- `checkboxDefinitions`

## Regras de negocio futuras

- templates devem ser versionados
- classificacao por template deve ser auditavel
- documento desconhecido pode resultar em `UNKNOWN` apenas quando o contexto estiver ativo
- a ativacao de template nao deve quebrar o processamento generico existente

## Portas futuras

### Entrada

- `CreateTemplateCommand`
- `PublishTemplateVersionCommand`
- `ClassifyDocumentByTemplateCommand`

### Saida

- `TemplateRepositoryPort`
- `TemplateArtifactStoragePort`

## Regras de clean code para o futuro

- matching de template deve viver em politicas nomeadas
- regras de classificacao nao devem ser espalhadas por adapters do worker
- nomes esperados: `classifyDocumentAgainstKnownTemplates`, `publishTemplateVersion`, `markTemplateAsDeprecated`

## Plano de implementacao

### No MVP

1. Nao implementar schema, endpoint ou CRUD.
2. Nao inserir campos de template nos agregados atuais.
3. Garantir por revisao arquitetural que a pipeline continua independente de template.

### Pos-MVP

1. Criar `TemplateDefinition` e suas politicas por TDD.
2. Criar matching service com dataset sintetico e fixtures reais.
3. Adicionar contratos administrativos para cadastro e publicacao.
4. Integrar classificacao de template como etapa opcional antes da extracao enriquecida.

## Criterio de pronto para ativacao futura

- templates versionados
- matching reproduzivel por testes
- fallback para processamento generico quando a classificacao nao for conclusiva
- auditoria de criacao, publicacao e classificacao
