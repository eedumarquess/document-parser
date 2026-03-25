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

function serialize(entry: LogRecord) {
  return {
    ...entry,
    recordedAt: entry.recordedAt.toISOString()
  };
}
