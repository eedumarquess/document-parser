import { createHash } from 'crypto';
import type { LogRecord } from './observability';

export type OtlpHttpExporterConfig = {
  endpoint: string;
  serviceName: string;
  headers?: Record<string, string>;
  fetchFn?: typeof fetch;
};

export function createOtlpHttpObservabilityAdapters(config: OtlpHttpExporterConfig) {
  const exporter = new OtlpHttpExporter(config);

  return {
    logging: new OtlpHttpLoggingAdapter(exporter),
    metrics: new OtlpHttpMetricsAdapter(exporter),
    tracing: new OtlpHttpTracingAdapter(exporter)
  };
}

export function parseOtlpHeaders(headerValue: string | undefined): Record<string, string> {
  if (headerValue === undefined || headerValue.trim() === '') {
    return {};
  }

  const headers: Record<string, string> = {};

  for (const segment of headerValue.split(',')) {
    const trimmedSegment = segment.trim();
    if (trimmedSegment === '') {
      continue;
    }

    const separatorIndex = trimmedSegment.indexOf('=');
    if (separatorIndex === -1) {
      headers[trimmedSegment] = '';
      continue;
    }

    const key = trimmedSegment.slice(0, separatorIndex).trim();
    if (key === '') {
      continue;
    }

    headers[key] = trimmedSegment.slice(separatorIndex + 1).trim();
  }

  return headers;
}

export class OtlpHttpLoggingAdapter {
  public constructor(private readonly exporter: OtlpHttpExporter) {}

  public async log(entry: LogRecord): Promise<void> {
    await this.exporter.send('/v1/logs', {
      resourceLogs: [
        {
          resource: buildResource(this.exporter.serviceName),
          scopeLogs: [
            {
              scope: { name: 'document-parser.observability' },
              logRecords: [
                {
                  timeUnixNano: toUnixNano(entry.recordedAt),
                  severityText: entry.level.toUpperCase(),
                  body: { stringValue: entry.message },
                  attributes: [
                    attribute('traceId', entry.traceId),
                    attribute('context', entry.context),
                    attribute('level', entry.level),
                    ...attributesFromRecord(entry.data)
                  ]
                }
              ]
            }
          ]
        }
      ]
    });
  }
}

export class OtlpHttpMetricsAdapter {
  public constructor(private readonly exporter: OtlpHttpExporter) {}

  public async increment(input: {
    name: string;
    value?: number;
    traceId?: string;
    tags?: Record<string, string>;
  }): Promise<void> {
    const now = new Date();

    await this.exporter.send('/v1/metrics', {
      resourceMetrics: [
        {
          resource: buildResource(this.exporter.serviceName),
          scopeMetrics: [
            {
              scope: { name: 'document-parser.observability' },
              metrics: [
                {
                  name: input.name,
                  sum: {
                    aggregationTemporality: 2,
                    isMonotonic: true,
                    dataPoints: [
                      {
                        timeUnixNano: toUnixNano(now),
                        asDouble: input.value ?? 1,
                        attributes: attributesFromTags(input.tags, input.traceId)
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      ]
    });
  }

  public async recordHistogram(input: {
    name: string;
    value: number;
    traceId?: string;
    tags?: Record<string, string>;
  }): Promise<void> {
    const now = new Date();

    await this.exporter.send('/v1/metrics', {
      resourceMetrics: [
        {
          resource: buildResource(this.exporter.serviceName),
          scopeMetrics: [
            {
              scope: { name: 'document-parser.observability' },
              metrics: [
                {
                  name: input.name,
                  histogram: {
                    aggregationTemporality: 2,
                    dataPoints: [
                      {
                        timeUnixNano: toUnixNano(now),
                        count: '1',
                        sum: input.value,
                        min: input.value,
                        max: input.value,
                        bucketCounts: ['1'],
                        explicitBounds: [],
                        attributes: attributesFromTags(input.tags, input.traceId)
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      ]
    });
  }
}

export class OtlpHttpTracingAdapter {
  public constructor(private readonly exporter: OtlpHttpExporter) {}

  public async runInSpan<T>(
    input: {
      traceId: string;
      spanName: string;
      attributes?: Record<string, unknown>;
    },
    work: () => Promise<T>
  ): Promise<T> {
    const startedAt = new Date();

    try {
      const result = await work();
      await this.sendSpan({
        traceId: input.traceId,
        spanName: input.spanName,
        attributes: input.attributes,
        startedAt,
        endedAt: new Date(),
        status: 'ok'
      });
      return result;
    } catch (error) {
      await this.sendSpan({
        traceId: input.traceId,
        spanName: input.spanName,
        attributes: {
          ...(input.attributes ?? {}),
          errorMessage: error instanceof Error ? error.message : 'Unexpected tracing failure'
        },
        startedAt,
        endedAt: new Date(),
        status: 'error'
      });
      throw error;
    }
  }

  private async sendSpan(input: {
    traceId: string;
    spanName: string;
    attributes?: Record<string, unknown>;
    startedAt: Date;
    endedAt: Date;
    status: 'ok' | 'error';
  }): Promise<void> {
    const spanId = createHash('sha256')
      .update(`${input.traceId}:${input.spanName}:${input.startedAt.toISOString()}`)
      .digest('hex')
      .slice(0, 16);

    await this.exporter.send('/v1/traces', {
      resourceSpans: [
        {
          resource: buildResource(this.exporter.serviceName),
          scopeSpans: [
            {
              scope: { name: 'document-parser.observability' },
              spans: [
                {
                  traceId: toOtlpTraceId(input.traceId),
                  spanId,
                  name: input.spanName,
                  startTimeUnixNano: toUnixNano(input.startedAt),
                  endTimeUnixNano: toUnixNano(input.endedAt),
                  attributes: [
                    attribute('traceId', input.traceId),
                    ...attributesFromRecord(input.attributes)
                  ],
                  status:
                    input.status === 'ok'
                      ? { code: 1 }
                      : {
                          code: 2,
                          message: serializeUnknownToString(input.attributes?.errorMessage, 'error')
                        }
                }
              ]
            }
          ]
        }
      ]
    });
  }
}

class OtlpHttpExporter {
  public readonly serviceName: string;
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly fetchFn: typeof fetch;

  public constructor(config: OtlpHttpExporterConfig) {
    this.serviceName = config.serviceName;
    this.endpoint = config.endpoint.replace(/\/+$/, '');
    this.headers = config.headers ?? {};
    this.fetchFn = config.fetchFn ?? fetch;
  }

  public async send(path: string, body: unknown): Promise<void> {
    try {
      await this.fetchFn(`${this.endpoint}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers
        },
        body: JSON.stringify(body)
      });
    } catch {
      return;
    }
  }
}

function buildResource(serviceName: string) {
  return {
    attributes: [attribute('service.name', serviceName)]
  };
}

function attribute(key: string, value: unknown) {
  return {
    key,
    value: toAnyValue(value)
  };
}

function attributesFromTags(
  tags: Record<string, string> | undefined,
  traceId: string | undefined
) {
  return [
    ...(traceId === undefined ? [] : [attribute('traceId', traceId)]),
    ...Object.entries(tags ?? {}).map(([key, value]) => attribute(key, value))
  ];
}

function attributesFromRecord(record: Record<string, unknown> | undefined) {
  if (record === undefined) {
    return [];
  }

  return Object.entries(record).map(([key, value]) => attribute(key, stringifyIfNeeded(value)));
}

function stringifyIfNeeded(value: unknown): unknown {
  if (
    value === undefined ||
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  return JSON.stringify(value);
}

function toAnyValue(value: unknown) {
  if (typeof value === 'boolean') {
    return { boolValue: value };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }
  if (value === undefined || value === null) {
    return { stringValue: '' };
  }

  return { stringValue: serializeUnknownToString(value) };
}

function serializeUnknownToString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return `${value}`;
  }

  if (typeof value === 'symbol') {
    return value.description ?? fallback;
  }

  if (typeof value === 'function') {
    return value.name || fallback;
  }

  if (value instanceof Error) {
    return value.message || fallback;
  }

  if (value === undefined || value === null) {
    return fallback;
  }

  try {
    return JSON.stringify(value) ?? fallback;
  } catch {
    return fallback;
  }
}

function toUnixNano(date: Date): string {
  return `${BigInt(date.getTime()) * 1_000_000n}`;
}

function toOtlpTraceId(traceId: string): string {
  return createHash('sha256').update(traceId).digest('hex').slice(0, 32);
}
