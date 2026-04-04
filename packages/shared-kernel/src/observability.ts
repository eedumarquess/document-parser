import { randomUUID } from 'crypto';
import { RedactionPolicyService } from './redaction-policy.service';
import { RetentionPolicyService } from './retention-policy.service';

export type LogLevel = 'info' | 'warn' | 'error';

export type LogRecord = {
  level: LogLevel;
  message: string;
  context: string;
  traceId: string;
  data?: Record<string, unknown>;
  recordedAt: Date;
};

export type MetricRecord =
  | {
      kind: 'counter';
      name: string;
      value: number;
      traceId?: string;
      tags?: Record<string, string>;
      recordedAt: Date;
    }
  | {
      kind: 'histogram';
      name: string;
      value: number;
      traceId?: string;
      tags?: Record<string, string>;
      recordedAt: Date;
    };

export type TraceSpanRecord = {
  traceId: string;
  spanName: string;
  attributes?: Record<string, unknown>;
  startedAt: Date;
  endedAt: Date;
  status: 'ok' | 'error';
  errorMessage?: string;
};

export type TelemetryEventKind = 'log' | 'metric' | 'span';

export type TelemetryEventBase = {
  telemetryEventId: string;
  kind: TelemetryEventKind;
  serviceName: string;
  traceId?: string;
  jobId?: string;
  documentId?: string;
  attemptId?: string;
  operation?: string;
  occurredAt: Date;
  retentionUntil: Date;
};

export type TelemetryLogEventRecord = TelemetryEventBase & {
  kind: 'log';
  level: LogLevel;
  message: string;
  context: string;
  data?: Record<string, unknown>;
};

export type TelemetryMetricEventRecord = TelemetryEventBase & {
  kind: 'metric';
  metricKind: 'counter' | 'histogram';
  name: string;
  value: number;
  tags?: Record<string, string>;
};

export type TelemetrySpanEventRecord = TelemetryEventBase & {
  kind: 'span';
  spanName: string;
  attributes?: Record<string, unknown>;
  startedAt: Date;
  endedAt: Date;
  status: 'ok' | 'error';
  errorMessage?: string;
};

export type TelemetryEventRecord =
  | TelemetryLogEventRecord
  | TelemetryMetricEventRecord
  | TelemetrySpanEventRecord;

export interface TelemetryEventSinkPort {
  save(event: TelemetryEventRecord): Promise<void>;
}

export class JsonConsoleLoggingAdapter {
  public async log(entry: LogRecord): Promise<void> {
    console.log(JSON.stringify({ type: 'log', ...serialize(entry) }));
  }
}

export class InMemoryLoggingAdapter {
  public readonly entries: LogRecord[] = [];

  public async log(entry: LogRecord): Promise<void> {
    this.entries.push(entry);
  }
}

export class JsonConsoleMetricsAdapter {
  public async increment(input: {
    name: string;
    value?: number;
    traceId?: string;
    tags?: Record<string, string>;
  }): Promise<void> {
    console.log(
      JSON.stringify({
        type: 'metric',
        kind: 'counter',
        name: input.name,
        value: input.value ?? 1,
        traceId: input.traceId,
        tags: input.tags,
        recordedAt: new Date().toISOString()
      })
    );
  }

  public async recordHistogram(input: {
    name: string;
    value: number;
    traceId?: string;
    tags?: Record<string, string>;
  }): Promise<void> {
    console.log(
      JSON.stringify({
        type: 'metric',
        kind: 'histogram',
        name: input.name,
        value: input.value,
        traceId: input.traceId,
        tags: input.tags,
        recordedAt: new Date().toISOString()
      })
    );
  }
}

export class InMemoryMetricsAdapter {
  public readonly records: MetricRecord[] = [];

  public async increment(input: {
    name: string;
    value?: number;
    traceId?: string;
    tags?: Record<string, string>;
  }): Promise<void> {
    this.records.push({
      kind: 'counter',
      name: input.name,
      value: input.value ?? 1,
      traceId: input.traceId,
      tags: input.tags,
      recordedAt: new Date()
    });
  }

  public async recordHistogram(input: {
    name: string;
    value: number;
    traceId?: string;
    tags?: Record<string, string>;
  }): Promise<void> {
    this.records.push({
      kind: 'histogram',
      name: input.name,
      value: input.value,
      traceId: input.traceId,
      tags: input.tags,
      recordedAt: new Date()
    });
  }
}

export class JsonConsoleTracingAdapter {
  public async runInSpan<T>(input: {
    traceId: string;
    spanName: string;
    attributes?: Record<string, unknown>;
  }, work: () => Promise<T>): Promise<T> {
    const startedAt = new Date();

    try {
      const result = await work();
      console.log(
        JSON.stringify({
          type: 'trace',
          traceId: input.traceId,
          spanName: input.spanName,
          attributes: input.attributes,
          startedAt: startedAt.toISOString(),
          endedAt: new Date().toISOString(),
          status: 'ok'
        })
      );
      return result;
    } catch (error) {
      console.log(
        JSON.stringify({
          type: 'trace',
          traceId: input.traceId,
          spanName: input.spanName,
          attributes: input.attributes,
          startedAt: startedAt.toISOString(),
          endedAt: new Date().toISOString(),
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Unexpected tracing failure'
        })
      );
      throw error;
    }
  }
}

export class InMemoryTracingAdapter {
  public readonly spans: TraceSpanRecord[] = [];

  public async runInSpan<T>(input: {
    traceId: string;
    spanName: string;
    attributes?: Record<string, unknown>;
  }, work: () => Promise<T>): Promise<T> {
    const startedAt = new Date();

    try {
      const result = await work();
      this.spans.push({
        traceId: input.traceId,
        spanName: input.spanName,
        attributes: input.attributes,
        startedAt,
        endedAt: new Date(),
        status: 'ok'
      });
      return result;
    } catch (error) {
      this.spans.push({
        traceId: input.traceId,
        spanName: input.spanName,
        attributes: input.attributes,
        startedAt,
        endedAt: new Date(),
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unexpected tracing failure'
      });
      throw error;
    }
  }
}

export function createFanOutObservabilityAdapters(config: {
  serviceName: string;
  sink: TelemetryEventSinkPort;
  logging: {
    log(entry: LogRecord): Promise<void>;
  };
  metrics: {
    increment(input: {
      name: string;
      value?: number;
      traceId?: string;
      tags?: Record<string, string>;
    }): Promise<void>;
    recordHistogram(input: {
      name: string;
      value: number;
      traceId?: string;
      tags?: Record<string, string>;
    }): Promise<void>;
  };
  tracing: {
    runInSpan<T>(
      input: {
        traceId: string;
        spanName: string;
        attributes?: Record<string, unknown>;
      },
      work: () => Promise<T>
    ): Promise<T>;
  };
  retentionPolicy?: RetentionPolicyService;
  redactionPolicy?: RedactionPolicyService;
}) {
  const retentionPolicy = config.retentionPolicy ?? new RetentionPolicyService();
  const redactionPolicy = config.redactionPolicy ?? new RedactionPolicyService();

  return {
    logging: new FanOutLoggingAdapter(
      config.serviceName,
      config.logging,
      config.sink,
      retentionPolicy,
      redactionPolicy
    ),
    metrics: new FanOutMetricsAdapter(
      config.serviceName,
      config.metrics,
      config.sink,
      retentionPolicy
    ),
    tracing: new FanOutTracingAdapter(
      config.serviceName,
      config.tracing,
      config.sink,
      retentionPolicy,
      redactionPolicy
    )
  };
}

class FanOutLoggingAdapter {
  public constructor(
    private readonly serviceName: string,
    private readonly primary: {
      log(entry: LogRecord): Promise<void>;
    },
    private readonly sink: TelemetryEventSinkPort,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly redactionPolicy: RedactionPolicyService
  ) {}

  public async log(entry: LogRecord): Promise<void> {
    await this.primary.log(entry);
    await swallowTelemetryPersistence(async () => {
      await this.sink.save(
        buildLogTelemetryEvent(
          this.serviceName,
          entry,
          this.retentionPolicy,
          this.redactionPolicy
        )
      );
    });
  }
}

class FanOutMetricsAdapter {
  public constructor(
    private readonly serviceName: string,
    private readonly primary: {
      increment(input: {
        name: string;
        value?: number;
        traceId?: string;
        tags?: Record<string, string>;
      }): Promise<void>;
      recordHistogram(input: {
        name: string;
        value: number;
        traceId?: string;
        tags?: Record<string, string>;
      }): Promise<void>;
    },
    private readonly sink: TelemetryEventSinkPort,
    private readonly retentionPolicy: RetentionPolicyService
  ) {}

  public async increment(input: {
    name: string;
    value?: number;
    traceId?: string;
    tags?: Record<string, string>;
  }): Promise<void> {
    await this.primary.increment(input);
    await swallowTelemetryPersistence(async () => {
      await this.sink.save(
        buildMetricTelemetryEvent(this.serviceName, {
          metricKind: 'counter',
          name: input.name,
          value: input.value ?? 1,
          traceId: input.traceId,
          tags: input.tags,
          occurredAt: new Date()
        }, this.retentionPolicy)
      );
    });
  }

  public async recordHistogram(input: {
    name: string;
    value: number;
    traceId?: string;
    tags?: Record<string, string>;
  }): Promise<void> {
    await this.primary.recordHistogram(input);
    await swallowTelemetryPersistence(async () => {
      await this.sink.save(
        buildMetricTelemetryEvent(this.serviceName, {
          metricKind: 'histogram',
          name: input.name,
          value: input.value,
          traceId: input.traceId,
          tags: input.tags,
          occurredAt: new Date()
        }, this.retentionPolicy)
      );
    });
  }
}

class FanOutTracingAdapter {
  public constructor(
    private readonly serviceName: string,
    private readonly primary: {
      runInSpan<T>(
        input: {
          traceId: string;
          spanName: string;
          attributes?: Record<string, unknown>;
        },
        work: () => Promise<T>
      ): Promise<T>;
    },
    private readonly sink: TelemetryEventSinkPort,
    private readonly retentionPolicy: RetentionPolicyService,
    private readonly redactionPolicy: RedactionPolicyService
  ) {}

  public async runInSpan<T>(input: {
    traceId: string;
    spanName: string;
    attributes?: Record<string, unknown>;
  }, work: () => Promise<T>): Promise<T> {
    const startedAt = new Date();

    return this.primary.runInSpan(input, async () => {
      try {
        const result = await work();
        await this.persistSpan({
          traceId: input.traceId,
          spanName: input.spanName,
          attributes: input.attributes,
          startedAt,
          endedAt: new Date(),
          status: 'ok'
        });
        return result;
      } catch (error) {
        await this.persistSpan({
          traceId: input.traceId,
          spanName: input.spanName,
          attributes: input.attributes,
          startedAt,
          endedAt: new Date(),
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Unexpected tracing failure'
        });
        throw error;
      }
    });
  }

  private async persistSpan(input: {
    traceId: string;
    spanName: string;
    attributes?: Record<string, unknown>;
    startedAt: Date;
    endedAt: Date;
    status: 'ok' | 'error';
    errorMessage?: string;
  }): Promise<void> {
    await swallowTelemetryPersistence(async () => {
      await this.sink.save(
        buildSpanTelemetryEvent(
          this.serviceName,
          input,
          this.retentionPolicy,
          this.redactionPolicy
        )
      );
    });
  }
}

function serialize(entry: LogRecord) {
  return {
    ...entry,
    recordedAt: entry.recordedAt.toISOString()
  };
}

function buildLogTelemetryEvent(
  serviceName: string,
  entry: LogRecord,
  retentionPolicy: RetentionPolicyService,
  redactionPolicy: RedactionPolicyService
): TelemetryLogEventRecord {
  const data = entry.data === undefined
    ? undefined
    : redactionPolicy.redact(entry.data, { context: 'log' });
  const correlation = extractCorrelation(data);

  return {
    telemetryEventId: randomUUID(),
    kind: 'log',
    serviceName,
    traceId: entry.traceId,
    jobId: correlation.jobId,
    documentId: correlation.documentId,
    attemptId: correlation.attemptId,
    operation: correlation.operation ?? entry.context,
    level: entry.level,
    message: entry.message,
    context: entry.context,
    data,
    occurredAt: entry.recordedAt,
    retentionUntil: retentionPolicy.calculateTelemetryRetentionUntil(entry.recordedAt)
  };
}

function buildMetricTelemetryEvent(
  serviceName: string,
  input: {
    metricKind: 'counter' | 'histogram';
    name: string;
    value: number;
    traceId?: string;
    tags?: Record<string, string>;
    occurredAt: Date;
  },
  retentionPolicy: RetentionPolicyService
): TelemetryMetricEventRecord {
  const correlation = extractCorrelation(input.tags);

  return {
    telemetryEventId: randomUUID(),
    kind: 'metric',
    serviceName,
    traceId: input.traceId,
    jobId: correlation.jobId,
    documentId: correlation.documentId,
    attemptId: correlation.attemptId,
    operation: correlation.operation ?? input.name,
    metricKind: input.metricKind,
    name: input.name,
    value: input.value,
    tags: input.tags,
    occurredAt: input.occurredAt,
    retentionUntil: retentionPolicy.calculateTelemetryRetentionUntil(input.occurredAt)
  };
}

function buildSpanTelemetryEvent(
  serviceName: string,
  input: {
    traceId: string;
    spanName: string;
    attributes?: Record<string, unknown>;
    startedAt: Date;
    endedAt: Date;
    status: 'ok' | 'error';
    errorMessage?: string;
  },
  retentionPolicy: RetentionPolicyService,
  redactionPolicy: RedactionPolicyService
): TelemetrySpanEventRecord {
  const attributes = input.attributes === undefined
    ? undefined
    : redactionPolicy.redact(input.attributes, { context: 'log' });
  const correlation = extractCorrelation(attributes);

  return {
    telemetryEventId: randomUUID(),
    kind: 'span',
    serviceName,
    traceId: input.traceId,
    jobId: correlation.jobId,
    documentId: correlation.documentId,
    attemptId: correlation.attemptId,
    operation: correlation.operation ?? input.spanName,
    spanName: input.spanName,
    attributes,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    status: input.status,
    errorMessage: input.errorMessage,
    occurredAt: input.endedAt,
    retentionUntil: retentionPolicy.calculateTelemetryRetentionUntil(input.endedAt)
  };
}

function extractCorrelation(
  record: Record<string, unknown> | Record<string, string> | undefined
): {
  jobId?: string;
  documentId?: string;
  attemptId?: string;
  operation?: string;
} {
  return {
    jobId: readStringValue(record, 'jobId'),
    documentId: readStringValue(record, 'documentId'),
    attemptId: readStringValue(record, 'attemptId'),
    operation: readStringValue(record, 'operation')
  };
}

function readStringValue(
  record: Record<string, unknown> | Record<string, string> | undefined,
  key: string
): string | undefined {
  const value = record?.[key];
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${value}`;
  }
  return undefined;
}

async function swallowTelemetryPersistence(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch {
    return;
  }
}
