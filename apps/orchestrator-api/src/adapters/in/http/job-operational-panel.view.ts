import type { JobOperationalContextResponse } from '../../../contracts/http';

export function renderJobOperationalPanel(context: JobOperationalContextResponse): string {
  const telemetryByService = groupBy(
    context.telemetryEvents,
    (event) => event.serviceName
  );
  const telemetryServiceSummaries = Object.entries(telemetryByService).map(([serviceName, events]) => ({
    serviceName,
    logs: events.filter((event) => event.kind === 'log').length,
    metrics: events.filter((event) => event.kind === 'metric').length,
    spans: events.filter((event) => event.kind === 'span').length
  }));

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Operational Context ${escapeHtml(context.summary.jobId)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f1ea;
        --panel: #fffdf8;
        --line: #d3c6b7;
        --text: #2c241b;
        --muted: #7d6d5b;
        --accent: #0e6b64;
        --accent-soft: #d7f0ed;
        --danger: #a33d29;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background:
          radial-gradient(circle at top left, rgba(14,107,100,0.14), transparent 30%),
          linear-gradient(180deg, #fbf7f0 0%, var(--bg) 100%);
        color: var(--text);
      }
      main {
        max-width: 1240px;
        margin: 0 auto;
        padding: 32px 20px 56px;
      }
      h1, h2, h3 { margin: 0; }
      h1 {
        font-size: 2.1rem;
        letter-spacing: 0.02em;
      }
      .subtitle {
        color: var(--muted);
        margin-top: 8px;
        font-size: 0.98rem;
      }
      section {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 18px;
        margin-top: 18px;
        box-shadow: 0 14px 40px rgba(51, 35, 16, 0.05);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
        margin-top: 16px;
      }
      .card {
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 12px;
        background: rgba(255,255,255,0.72);
      }
      .label {
        color: var(--muted);
        font-size: 0.84rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .value {
        margin-top: 6px;
        font-size: 1rem;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .timeline {
        display: grid;
        gap: 10px;
        margin-top: 16px;
      }
      .timeline-item {
        border-left: 4px solid var(--accent);
        padding: 10px 12px;
        background: rgba(215,240,237,0.35);
        border-radius: 0 12px 12px 0;
      }
      .timeline-meta {
        color: var(--muted);
        font-size: 0.84rem;
        margin-top: 4px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 14px;
      }
      th, td {
        text-align: left;
        padding: 10px 8px;
        border-bottom: 1px solid var(--line);
        vertical-align: top;
        font-size: 0.95rem;
      }
      th {
        color: var(--muted);
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "Courier New", monospace;
        font-size: 0.86rem;
      }
      .pill {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 0.84rem;
      }
      .danger {
        color: var(--danger);
      }
      .trace-list {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 12px;
      }
      .section-intro {
        color: var(--muted);
        margin-top: 8px;
      }
      .empty {
        color: var(--muted);
        margin-top: 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Operational Context</h1>
        <p class="subtitle">
          Job <strong>${escapeHtml(context.summary.jobId)}</strong> for document
          <strong>${escapeHtml(context.summary.documentId)}</strong>
        </p>
      </header>

      <section>
        <h2>Operational Totals</h2>
        <p class="section-intro">Fast counters to orient the inspection before drilling into timeline and payload details.</p>
        <div class="grid">
          ${summaryCard('Trace IDs', `${context.traceIds.length}`)}
          ${summaryCard('Timeline Items', `${context.timeline.length}`)}
          ${summaryCard('Attempts', `${context.attempts.length}`)}
          ${summaryCard('Telemetry Events', `${context.telemetryEvents.length}`)}
          ${summaryCard('Artifacts', `${context.artifacts.length}`)}
          ${summaryCard('Dead Letters', `${context.deadLetters.length}`)}
        </div>
      </section>

      <section>
        <h2>Summary</h2>
        <div class="grid">
          ${summaryCard('Status', context.summary.status)}
          ${summaryCard('Requested Mode', context.summary.requestedMode)}
          ${summaryCard('Queue', context.summary.queueName)}
          ${summaryCard('Priority', context.summary.priority)}
          ${summaryCard('Pipeline', context.summary.pipelineVersion)}
          ${summaryCard('Output', context.summary.outputVersion)}
          ${summaryCard('Warnings', context.summary.warnings.join(', ') || 'none')}
          ${summaryCard('Error', context.summary.errorCode ? `${context.summary.errorCode}: ${context.summary.errorMessage ?? ''}` : 'none')}
        </div>
        <div class="trace-list">
          ${context.traceIds.length === 0
            ? '<span class="empty">No trace IDs associated with this job yet.</span>'
            : context.traceIds.map((traceId: string) => `<span class="pill">${escapeHtml(traceId)}</span>`).join('')}
        </div>
      </section>

      <section>
        <h2>Queue Publication</h2>
        ${context.queuePublication === undefined
          ? '<p>No queue publication outbox record for this job.</p>'
          : `
            <div class="grid">
              ${summaryCard('Status', context.queuePublication.status)}
              ${summaryCard('Owner', context.queuePublication.ownerService)}
              ${summaryCard('Flow', context.queuePublication.flowType)}
              ${summaryCard('Dispatch', context.queuePublication.dispatchKind)}
              ${summaryCard('Publish Attempts', `${context.queuePublication.publishAttempts}`)}
              ${summaryCard('Available At', context.queuePublication.availableAt)}
              ${summaryCard('Published At', context.queuePublication.publishedAt ?? 'pending')}
              ${summaryCard('Last Error', context.queuePublication.lastError ?? 'none')}
            </div>
          `}
      </section>

      <section>
        <h2>Timeline</h2>
        <div class="timeline">
          ${context.timeline.map((item: JobOperationalContextResponse['timeline'][number]) => `
            <article class="timeline-item">
              <strong>${escapeHtml(item.title)}</strong>
              <div>${escapeHtml(item.detail)}</div>
              <div class="timeline-meta">
                ${escapeHtml(item.occurredAt)}
                ${item.serviceName === undefined ? '' : ` | ${escapeHtml(item.serviceName)}`}
                ${item.traceId === undefined ? '' : ` | ${escapeHtml(item.traceId)}`}
                ${item.attemptId === undefined ? '' : ` | ${escapeHtml(item.attemptId)}`}
              </div>
            </article>
          `).join('')}
        </div>
      </section>

      <section>
        <h2>Attempts</h2>
        ${renderAttemptsTable(context)}
      </section>

      <section>
        <h2>Result</h2>
        ${context.result === undefined ? '<p>No result persisted yet.</p>' : `
          <div class="grid">
            ${summaryCard('Status', context.result.status)}
            ${summaryCard('Engine', context.result.engineUsed)}
            ${summaryCard('Confidence', `${context.result.confidence}`)}
            ${summaryCard('Latency', `${context.result.totalLatencyMs} ms`)}
          </div>
          <div class="card" style="margin-top: 14px;">
            <div class="label">Payload</div>
            <div class="value">${escapeHtml(context.result.payload)}</div>
          </div>
        `}
      </section>

      <section>
        <h2>Dead Letters</h2>
        ${renderDeadLettersTable(context)}
      </section>

      <section>
        <h2>Audit Events</h2>
        ${renderAuditTable(context)}
      </section>

      <section>
        <h2>Telemetry</h2>
        <p class="section-intro">Grouped by service so it is easier to separate API orchestration from worker execution.</p>
        <div class="grid">
          ${telemetryServiceSummaries.length === 0
            ? '<p class="empty">No telemetry persisted for this job.</p>'
            : telemetryServiceSummaries.map((summary) => `
                <article class="card">
                  <div class="label">${escapeHtml(summary.serviceName)}</div>
                  <div class="value">logs ${summary.logs} | metrics ${summary.metrics} | spans ${summary.spans}</div>
                </article>
              `).join('')}
        </div>
        ${(Object.entries(telemetryByService) as Array<[string, JobOperationalContextResponse['telemetryEvents']]>).map(([serviceName, events]) => `
          <article class="card" style="margin-top: 14px;">
            <h3>${escapeHtml(serviceName)}</h3>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Kind</th>
                  <th>Operation</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                ${events.map((event: JobOperationalContextResponse['telemetryEvents'][number]) => `
                  <tr>
                    <td>${escapeHtml(event.occurredAt)}</td>
                    <td>${escapeHtml(event.kind)}</td>
                    <td>${escapeHtml(event.operation ?? '')}</td>
                    <td><pre>${escapeHtml(describeTelemetry(event))}</pre></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </article>
        `).join('')}
      </section>

      <section>
        <h2>Artifacts</h2>
        <p class="section-intro">The preview column is derived at read time and never exposes raw OCR, prompt or response payloads.</p>
        ${renderArtifactsTable(context)}
      </section>
    </main>
  </body>
</html>`;
}

function renderAttemptsTable(context: JobOperationalContextResponse): string {
  return `<table>
    <thead>
      <tr>
        <th>Attempt</th>
        <th>Status</th>
        <th>Fallback</th>
        <th>Versions</th>
        <th>Error</th>
      </tr>
    </thead>
    <tbody>
      ${context.attempts.map((attempt: JobOperationalContextResponse['attempts'][number]) => `
        <tr>
          <td>
            <strong>${escapeHtml(attempt.attemptId)}</strong><br />
            #${attempt.attemptNumber}
          </td>
          <td>${escapeHtml(attempt.status)}</td>
          <td>${escapeHtml(attempt.fallbackUsed ? attempt.fallbackReason ?? 'used' : 'none')}</td>
          <td>
            <pre>${escapeHtml(JSON.stringify({
              pipelineVersion: attempt.pipelineVersion,
              promptVersion: attempt.promptVersion,
              modelVersion: attempt.modelVersion,
              normalizationVersion: attempt.normalizationVersion,
              latencyMs: attempt.latencyMs
            }, null, 2))}</pre>
          </td>
          <td class="${attempt.errorCode === undefined ? '' : 'danger'}">
            <pre>${escapeHtml(JSON.stringify({
              errorCode: attempt.errorCode,
              errorDetails: attempt.errorDetails
            }, null, 2))}</pre>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

function renderDeadLettersTable(context: JobOperationalContextResponse): string {
  if (context.deadLetters.length === 0) {
    return '<p>No dead-letter records for this job.</p>';
  }

  return `<table>
    <thead>
      <tr>
        <th>DLQ Event</th>
        <th>Reason</th>
        <th>Trace</th>
        <th>Payload</th>
      </tr>
    </thead>
    <tbody>
      ${context.deadLetters.map((record: JobOperationalContextResponse['deadLetters'][number]) => `
        <tr>
          <td>${escapeHtml(record.dlqEventId)}</td>
          <td>${escapeHtml(`${record.reasonCode}: ${record.reasonMessage}`)}</td>
          <td>${escapeHtml(record.traceId)}</td>
          <td><pre>${escapeHtml(JSON.stringify(record.payloadSnapshot ?? {}, null, 2))}</pre></td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

function renderAuditTable(context: JobOperationalContextResponse): string {
  return `<table>
    <thead>
      <tr>
        <th>When</th>
        <th>Event</th>
        <th>Trace</th>
        <th>Metadata</th>
      </tr>
    </thead>
    <tbody>
      ${context.auditEvents.map((event: JobOperationalContextResponse['auditEvents'][number]) => `
        <tr>
          <td>${escapeHtml(event.createdAt)}</td>
          <td>${escapeHtml(event.eventType)}</td>
          <td>${escapeHtml(event.traceId)}</td>
          <td><pre>${escapeHtml(JSON.stringify(event.metadata ?? {}, null, 2))}</pre></td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

function renderArtifactsTable(context: JobOperationalContextResponse): string {
  if (context.artifacts.length === 0) {
    return '<p>No artifacts persisted yet.</p>';
  }

  return `<table>
    <thead>
      <tr>
        <th>Artifact</th>
        <th>Page</th>
        <th>Storage</th>
        <th>Retention</th>
        <th>Metadata</th>
        <th>Preview</th>
      </tr>
    </thead>
    <tbody>
      ${context.artifacts.map((artifact: JobOperationalContextResponse['artifacts'][number]) => `
        <tr>
          <td>
            <strong>${escapeHtml(artifact.artifactType)}</strong><br />
            ${escapeHtml(artifact.artifactId)}
          </td>
          <td>${escapeHtml(artifact.pageNumber === undefined ? '-' : `${artifact.pageNumber}`)}</td>
          <td>${escapeHtml(`${artifact.storageBucket}/${artifact.storageObjectKey}`)}</td>
          <td>${escapeHtml(artifact.retentionUntil)}</td>
          <td><pre>${escapeHtml(JSON.stringify(artifact.metadata ?? {}, null, 2))}</pre></td>
          <td><pre>${escapeHtml(artifact.previewText ?? '')}</pre></td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

function describeTelemetry(event: JobOperationalContextResponse['telemetryEvents'][number]): string {
  if (event.kind === 'log') {
    return JSON.stringify({
      level: event.level,
      message: event.message,
      context: event.context,
      traceId: event.traceId,
      data: event.data
    }, null, 2);
  }

  if (event.kind === 'metric') {
    return JSON.stringify({
      metricKind: event.metricKind,
      name: event.name,
      value: event.value,
      traceId: event.traceId,
      tags: event.tags
    }, null, 2);
  }

  return JSON.stringify({
    spanName: event.spanName,
    status: event.status,
    traceId: event.traceId,
    attributes: event.attributes,
    errorMessage: event.errorMessage
  }, null, 2);
}

function summaryCard(label: string, value: string): string {
  return `
    <article class="card">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value)}</div>
    </article>
  `;
}

function groupBy<T>(items: T[], selectKey: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = selectKey(item);
    groups[key] ??= [];
    groups[key].push(item);
  }
  return groups;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
