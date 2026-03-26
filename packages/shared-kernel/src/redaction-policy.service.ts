const REDACTED_VALUE = '[REDACTED]';
const REDACTED_BINARY = '[REDACTED_BINARY]';

const HARD_REDACT_KEY_PATTERN =
  /(^|\.)(payload|rawText|rawPayload|promptText|responseText|buffer|binary|content|original|originalBuffer)$/i;
const OPERATIONAL_KEY_PATTERN =
  /(^|\.)(traceId|actorId|role|jobId|documentId|attemptId|resultId|dlqEventId|sourceJobId|sourceResultId|reprocessOfJobId|queueName|status|eventType|aggregateType|aggregateId|requestedMode|priority|pipelineVersion|outputVersion|promptVersion|modelVersion|normalizationVersion|fallbackReason|artifactType|pageNumber|retryCount|retryDelayMs|attemptNumber|confidence|latencyMs|totalLatencyMs|fileSizeBytes|pageCount|mimeType|forceReprocess|reusedResult|retrySourceAttemptId|reasonCode|errorCode|hash|warnings|missingResources|publishedAt|createdAt|updatedAt|retentionUntil|acceptedAt|queuedAt|startedAt|finishedAt)$/i;
const FREE_TEXT_KEY_PATTERN =
  /(^|\.)(reason|errorMessage|message|description|details|note|notes|comment|comments|input|output|query|text)$/i;

const SEMANTIC_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    replacement: '[email]'
  },
  {
    pattern: /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}-?\d{4}\b/g,
    replacement: '[phone]'
  },
  {
    pattern: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
    replacement: '[cpf]'
  },
  {
    pattern: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,
    replacement: '[cnpj]'
  },
  {
    pattern: /\b\d{5}-?\d{3}\b/g,
    replacement: '[cep]'
  },
  {
    pattern: /\b(?:bearer\s+)?[A-Za-z0-9_\-.]{20,}\b/g,
    replacement: '[token]'
  }
];

export type RedactionContext = 'audit' | 'log' | 'dead_letter' | 'artifact';

type RedactionOptions = {
  context?: RedactionContext;
};

export class RedactionPolicyService {
  public redact<T>(value: T, options: RedactionOptions = {}): T {
    return this.redactValue(value, '', options.context ?? 'audit') as T;
  }

  public sanitizeMetadata<T>(value: T, options: RedactionOptions = {}): T {
    return this.sanitizeMetadataValue(value, '', options.context ?? 'audit') as T;
  }

  private redactValue(value: unknown, path: string, context: RedactionContext): unknown {
    if (Buffer.isBuffer(value)) {
      return REDACTED_BINARY;
    }

    if (Array.isArray(value)) {
      return value.map((item, index) => this.redactValue(item, `${path}[${index}]`, context));
    }

    if (value instanceof Date || value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      return this.redactString(value, path);
    }

    if (typeof value !== 'object') {
      return value;
    }

    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(input)) {
      const keyPath = buildPath(path, key);

      output[key] = HARD_REDACT_KEY_PATTERN.test(normalizePath(keyPath))
        ? redactSensitiveValue(item)
        : this.redactValue(item, keyPath, context);
    }

    return output;
  }

  private sanitizeMetadataValue(value: unknown, path: string, context: RedactionContext): unknown {
    if (Buffer.isBuffer(value)) {
      return REDACTED_BINARY;
    }

    if (Array.isArray(value)) {
      if (!isOperationalPath(path)) {
        return collapseValue(value);
      }

      return value.map((item, index) =>
        this.sanitizeMetadataValue(item, `${path}[${index}]`, context)
      );
    }

    if (value instanceof Date || value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      return isOperationalPath(path) && !isFreeTextPath(path)
        ? value
        : this.redactString(value, path);
    }

    if (typeof value !== 'object') {
      return isOperationalPath(path) ? value : collapseValue(value);
    }

    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(input)) {
      const keyPath = buildPath(path, key);
      const normalizedPath = normalizePath(keyPath);

      if (HARD_REDACT_KEY_PATTERN.test(normalizedPath)) {
        output[key] = redactSensitiveValue(item);
        continue;
      }

      if (!isOperationalPath(keyPath)) {
        output[key] = collapseValue(item);
        continue;
      }

      output[key] = this.sanitizeMetadataValue(item, keyPath, context);
    }

    return output;
  }

  private redactString(value: string, path: string): string {
    if (value === '') {
      return value;
    }

    if (isOperationalPath(path) && !isFreeTextPath(path)) {
      return value;
    }

    let redacted = value;
    for (const { pattern, replacement } of SEMANTIC_REPLACEMENTS) {
      redacted = redacted.replaceAll(pattern, replacement);
    }

    return redacted;
  }
}

function redactSensitiveValue(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    return REDACTED_BINARY;
  }

  return REDACTED_VALUE;
}

function collapseValue(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    return REDACTED_BINARY;
  }

  return REDACTED_VALUE;
}

function buildPath(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

function normalizePath(path: string): string {
  return path.replaceAll(/\[\d+\]/g, '');
}

function isOperationalPath(path: string): boolean {
  return OPERATIONAL_KEY_PATTERN.test(normalizePath(path));
}

function isFreeTextPath(path: string): boolean {
  return FREE_TEXT_KEY_PATTERN.test(normalizePath(path));
}
