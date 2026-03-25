const REDACTED_VALUE = '[REDACTED]';
const REDACTED_BINARY = '[REDACTED_BINARY]';
const SENSITIVE_KEY_PATTERN =
  /(^|\.)(payload|rawText|rawPayload|promptText|responseText|buffer|binary|content|original|originalBuffer)$/i;

export class RedactionPolicyService {
  public redact<T>(value: T): T {
    return this.redactValue(value, '') as T;
  }

  private redactValue(value: unknown, path: string): unknown {
    if (Buffer.isBuffer(value)) {
      return REDACTED_BINARY;
    }

    if (Array.isArray(value)) {
      return value.map((item, index) => this.redactValue(item, `${path}[${index}]`));
    }

    if (value instanceof Date || value === null || value === undefined) {
      return value;
    }

    if (typeof value !== 'object') {
      return value;
    }

    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(input)) {
      const keyPath = path === '' ? key : `${path}.${key}`;
      output[key] = SENSITIVE_KEY_PATTERN.test(keyPath)
        ? redactSensitiveValue(item)
        : this.redactValue(item, keyPath);
    }

    return output;
  }
}

function redactSensitiveValue(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    return REDACTED_BINARY;
  }

  return REDACTED_VALUE;
}
