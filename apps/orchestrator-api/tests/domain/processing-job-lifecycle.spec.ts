import {
  createDeduplicatedJob,
  createReprocessingJob,
  markJobAsPublishPending,
  createSubmissionJob,
  markJobAsQueued,
  markJobAsStored,
  markJobAsValidated
} from '@document-parser/document-processing-domain';
import {
  DEFAULT_OUTPUT_VERSION,
  DEFAULT_PIPELINE_VERSION,
  DEFAULT_PROCESSING_QUEUE_NAME,
  JobStatus
} from '@document-parser/shared-kernel';
import { buildActor } from '@document-parser/testkit';

describe('Processing job lifecycle', () => {
  const actor = buildActor();
  const now = new Date('2026-03-25T12:00:00.000Z');

  it('walks the standard lifecycle from RECEIVED to QUEUED through PUBLISH_PENDING', () => {
    const received = createSubmissionJob({
      jobId: 'job-1',
      documentId: 'doc-1',
      requestedMode: 'STANDARD',
      queueName: DEFAULT_PROCESSING_QUEUE_NAME,
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      requestedBy: actor,
      forceReprocess: false,
      now
    });

    const validated = markJobAsValidated({ job: received, now });
    const stored = markJobAsStored({ job: validated, now });
    const publishPending = markJobAsPublishPending({ job: stored, now });
    const queued = markJobAsQueued({ job: publishPending, now });

    expect(queued.status).toBe(JobStatus.QUEUED);
    expect(queued.ingestionTransitions.map((transition) => transition.status)).toEqual([
      JobStatus.RECEIVED,
      JobStatus.VALIDATED,
      JobStatus.STORED,
      JobStatus.PUBLISH_PENDING,
      JobStatus.QUEUED
    ]);
  });

  it('creates a deduplicated terminal job without queueing', () => {
    const job = createDeduplicatedJob({
      jobId: 'job-1',
      documentId: 'doc-1',
      requestedMode: 'STANDARD',
      queueName: DEFAULT_PROCESSING_QUEUE_NAME,
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      requestedBy: actor,
      compatibleResult: {
        resultId: 'result-1',
        jobId: 'job-source',
        documentId: 'doc-1',
        compatibilityKey: 'sha256:doc-1:STANDARD:git-sha:1.0.0',
        status: JobStatus.PARTIAL,
        requestedMode: 'STANDARD',
        pipelineVersion: DEFAULT_PIPELINE_VERSION,
        outputVersion: DEFAULT_OUTPUT_VERSION,
        confidence: 0.61,
        warnings: ['ILLEGIBLE_CONTENT'],
        payload: '[ilegivel]',
        engineUsed: 'OCR',
        totalLatencyMs: 1000,
        createdAt: now,
        updatedAt: now,
        retentionUntil: new Date('2026-06-23T12:00:00.000Z')
      },
      now
    });

    expect(job.status).toBe(JobStatus.PARTIAL);
    expect(job.reusedResult).toBe(true);
    expect(job.finishedAt).toEqual(now);
    expect(job.ingestionTransitions.map((transition) => transition.status)).toContain(JobStatus.DEDUPLICATED);
  });

  it('creates a reprocessing job with explicit REPROCESSED transition', () => {
    const reprocessed = createReprocessingJob({
      jobId: 'job-2',
      documentId: 'doc-1',
      requestedMode: 'STANDARD',
      queueName: DEFAULT_PROCESSING_QUEUE_NAME,
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      requestedBy: actor,
      reprocessOfJobId: 'job-1',
      now
    });

    expect(reprocessed.status).toBe(JobStatus.REPROCESSED);
    expect(reprocessed.reprocessOfJobId).toBe('job-1');
    expect(reprocessed.ingestionTransitions.map((transition) => transition.status)).toEqual([
      JobStatus.RECEIVED,
      JobStatus.REPROCESSED
    ]);
  });

  it('rejects invalid state jumps', () => {
    const received = createSubmissionJob({
      jobId: 'job-1',
      documentId: 'doc-1',
      requestedMode: 'STANDARD',
      queueName: DEFAULT_PROCESSING_QUEUE_NAME,
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      requestedBy: actor,
      forceReprocess: false,
      now
    });

    expect(() => markJobAsQueued({ job: received, now })).toThrow('Cannot mark job as queued');
  });

  it('marks a stored job as PUBLISH_PENDING before queue publication', () => {
    const received = createSubmissionJob({
      jobId: 'job-2',
      documentId: 'doc-2',
      requestedMode: 'STANDARD',
      queueName: DEFAULT_PROCESSING_QUEUE_NAME,
      pipelineVersion: DEFAULT_PIPELINE_VERSION,
      outputVersion: DEFAULT_OUTPUT_VERSION,
      requestedBy: actor,
      forceReprocess: false,
      now
    });

    const publishPending = markJobAsPublishPending({
      job: markJobAsStored({
        job: markJobAsValidated({ job: received, now }),
        now
      }),
      now
    });

    expect(publishPending.status).toBe(JobStatus.PUBLISH_PENDING);
  });
});
