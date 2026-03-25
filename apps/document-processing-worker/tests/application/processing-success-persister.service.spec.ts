import { AttemptStatus, JobStatus, RedactionPolicyService, RetentionPolicyService, Role } from '@document-parser/shared-kernel';
import { IncrementalIdGenerator } from '@document-parser/testkit';
import {
  InMemoryAuditRepository,
  InMemoryJobAttemptRepository,
  InMemoryPageArtifactRepository,
  InMemoryProcessingJobRepository,
  InMemoryProcessingResultRepository,
  InMemoryUnitOfWork
} from '../../src/adapters/out/repositories/in-memory.repositories';
import { AuditEventRecorder } from '../../src/application/services/audit-event-recorder.service';
import { ProcessingSuccessPersister } from '../../src/application/services/processing-success-persister.service';

describe('ProcessingSuccessPersister', () => {
  it('persists artifacts, result, completed states and audit in one step', async () => {
    const idGenerator = new IncrementalIdGenerator();
    const jobs = new InMemoryProcessingJobRepository();
    const attempts = new InMemoryJobAttemptRepository();
    const results = new InMemoryProcessingResultRepository();
    const artifacts = new InMemoryPageArtifactRepository();
    const audit = new InMemoryAuditRepository();
    const retentionPolicy = new RetentionPolicyService();
    const redactionPolicy = new RedactionPolicyService();
    const service = new ProcessingSuccessPersister(
      idGenerator,
      jobs,
      attempts,
      results,
      artifacts,
      new InMemoryUnitOfWork(),
      retentionPolicy,
      new AuditEventRecorder(audit, idGenerator, retentionPolicy, redactionPolicy)
    );
    const now = new Date('2026-03-25T12:00:00.000Z');

    await jobs.save({
      jobId: 'job-1',
      documentId: 'doc-1',
      requestedMode: 'STANDARD',
      priority: 'NORMAL',
      queueName: 'document-processing.requested',
      status: JobStatus.PROCESSING,
      forceReprocess: false,
      reusedResult: false,
      pipelineVersion: 'git-sha',
      outputVersion: '1.0.0',
      acceptedAt: now,
      requestedBy: { actorId: 'owner-1', role: Role.OWNER },
      warnings: [],
      ingestionTransitions: [{ status: JobStatus.QUEUED, at: now }],
      createdAt: now,
      updatedAt: now
    });
    await attempts.save({
      attemptId: 'attempt-1',
      jobId: 'job-1',
      attemptNumber: 1,
      pipelineVersion: 'git-sha',
      status: AttemptStatus.PROCESSING,
      fallbackUsed: false,
      createdAt: now,
      startedAt: now
    });

    await service.persist({
      context: {
        message: {
          documentId: 'doc-1',
          jobId: 'job-1',
          attemptId: 'attempt-1',
          traceId: 'trace-success',
          requestedMode: 'STANDARD',
          pipelineVersion: 'git-sha',
          publishedAt: now.toISOString()
        },
        document: {
          documentId: 'doc-1',
          hash: 'sha256:doc',
          originalFileName: 'sample.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 128,
          pageCount: 1,
          sourceType: 'MULTIPART',
          storageReference: { bucket: 'documents', objectKey: 'original/doc-1/sample.pdf' },
          retentionUntil: now,
          createdAt: now,
          updatedAt: now
        },
        job: (await jobs.findById('job-1'))!,
        attempt: (await attempts.findById('attempt-1'))!,
        original: Buffer.from('conteudo')
      },
      outcome: {
        status: JobStatus.COMPLETED,
        engineUsed: 'OCR',
        confidence: 0.98,
        warnings: [],
        payload: 'conteudo',
        artifacts: [
          {
            artifactId: 'artifact-1',
            artifactType: 'OCR_JSON',
            storageBucket: 'artifacts',
            storageObjectKey: 'ocr/job-1/page-1.json',
            mimeType: 'application/json',
            pageNumber: 1
          }
        ],
        fallbackUsed: false,
        normalizationVersion: 'norm-v1',
        totalLatencyMs: 320
      },
      now
    });

    await expect(results.findByJobId('job-1')).resolves.toMatchObject({
      documentId: 'doc-1',
      status: JobStatus.COMPLETED,
      payload: 'conteudo'
    });
    await expect(jobs.findById('job-1')).resolves.toMatchObject({
      status: JobStatus.COMPLETED
    });
    await expect(attempts.findById('attempt-1')).resolves.toMatchObject({
      status: AttemptStatus.COMPLETED,
      latencyMs: 320
    });
    await expect(artifacts.listByJobId('job-1')).resolves.toEqual([
      expect.objectContaining({
        artifactId: 'artifact-1',
        documentId: 'doc-1'
      })
    ]);
    await expect(audit.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'PROCESSING_COMPLETED',
          traceId: 'trace-success'
        })
      ])
    );
  });
});
