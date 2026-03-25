# DDD: Ingestion

## Objetivo

Receber o documento, validar entrada, calcular identidade do conteúdo, persistir o original e aceitar ou rejeitar a criação do job.

## Responsabilidades

- Validar MIME, tamanho e quantidade de páginas
- Calcular hash determinístico do arquivo
- Aplicar idempotência por hash e versão de pipeline
- Persistir binário bruto no MinIO
- Criar `Document` e `ProcessingJob`
- Publicar comando assíncrono para processamento

## Agregado principal

### `Document`

Entidade que representa o arquivo submetido e seu ciclo de vida básico.

#### Atributos principais

- `documentId`
- `hash`
- `mimeType`
- `fileSizeBytes`
- `pageCount`
- `storageReference`
- `status`
- `retentionUntil`

#### Regras de negócio

- Um documento só é aceito se respeitar limites de tipo, tamanho e páginas
- O hash do conteúdo precisa ser calculado antes da decisão de aceite
- O original deve ser persistido antes da publicação do job
- Um documento duplicado pode reaproveitar resultado compatível

## Value objects

- `DocumentHash`
- `StorageReference`
- `MimeType`
- `DocumentLimits`
- `RetentionPolicy`

## Serviços de domínio

- `DocumentAcceptancePolicy`
- `DocumentDeduplicationPolicy`
- `DocumentStorageService`

## Repositórios

- `DocumentRepository`
- `ProcessingJobRepository`

## Eventos de domínio

- `DocumentAccepted`
- `DocumentRejected`
- `DocumentStored`
- `DocumentDeduplicated`
- `ProcessingJobRequested`

## Portas

### Entrada

- `SubmitDocumentCommand`

### Saída

- `BinaryStoragePort`
- `JobPublisherPort`
- `DocumentRepositoryPort`
- `ClockPort`
- `HashingPort`

## Casos de uso

1. Receber upload multipart
2. Validar entrada
3. Calcular hash
4. Verificar reaproveitamento
5. Persistir original
6. Criar documento e job
7. Publicar comando de processamento

## Anti-corruption rules

- HTTP não entra no domínio
- MinIO é acessado apenas por porta de storage
- RabbitMQ é acessado apenas por porta de publicação
