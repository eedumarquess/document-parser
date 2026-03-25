# DDD: Template Management

## Objetivo

Preparar o sistema para uma futura capacidade de classificação e extração guiada por template sem acoplar o MVP a um cadastro obrigatório.

## Responsabilidades

- Versionar templates documentais
- Manter regras de matching
- Definir campos esperados e semântica por layout
- Permitir ativação gradual por domínio documental

## Agregado principal

### `TemplateDefinition`

Representa uma definição versionada de template documental.

#### Atributos principais

- `templateId`
- `name`
- `documentDomain`
- `version`
- `status`
- `matchingRules`
- `fieldDefinitions`
- `checkboxDefinitions`

## Regras de negócio

- O MVP não depende de template para processar ficha clínica
- Templates futuros devem ser versionados e auditáveis
- Quando a classificação por template estiver ativa, documentos desconhecidos poderão resultar em `templateStatus=UNKNOWN`
- Falha por template desconhecido só entra quando esse subdomínio estiver ativado funcionalmente

## Value objects

- `TemplateVersion`
- `MatchingRule`
- `FieldDefinition`
- `CheckboxDefinition`
- `TemplateStatus`

## Serviços de domínio

- `TemplateMatchingService`
- `TemplateVersioningService`
- `TemplateActivationPolicy`

## Repositórios

- `TemplateDefinitionRepository`

## Eventos de domínio

- `TemplateCreated`
- `TemplateVersionPublished`
- `TemplateActivated`
- `TemplateDeprecated`
- `TemplateClassificationFailed`

## Portas

### Entrada

- `CreateTemplateCommand`
- `PublishTemplateVersionCommand`
- `ClassifyDocumentByTemplateCommand`

### Saída

- `TemplateRepositoryPort`
- `TemplateArtifactStoragePort`

## Papel no MVP

Subdomínio explícito no desenho, mas com implementação adiada. A existência dessa fronteira evita refatorações pesadas quando o parser passar de extração genérica para extração dirigida por layout.
