import type { ProcessingOutcome } from '@document-parser/shared-kernel';
import type { ProcessingResultRecord } from '../../contracts/models';
import { CompatibilityKey } from '../value-objects/compatibility-key';

export class ProcessingResultEntity {
  public static create(input: {
    resultId: string;
    jobId: string;
    documentId: string;
    hash: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
    outcome: ProcessingOutcome;
    retentionUntil: Date;
    now: Date;
  }): ProcessingResultRecord {
    return {
      resultId: input.resultId,
      jobId: input.jobId,
      documentId: input.documentId,
      compatibilityKey: CompatibilityKey.build({
        hash: input.hash,
        requestedMode: input.requestedMode,
        pipelineVersion: input.pipelineVersion,
        outputVersion: input.outputVersion
      }),
      status: input.outcome.status,
      requestedMode: input.requestedMode,
      pipelineVersion: input.pipelineVersion,
      outputVersion: input.outputVersion,
      confidence: input.outcome.confidence,
      warnings: input.outcome.warnings,
      payload: input.outcome.payload,
      engineUsed: input.outcome.engineUsed,
      totalLatencyMs: input.outcome.totalLatencyMs,
      promptVersion: input.outcome.promptVersion,
      modelVersion: input.outcome.modelVersion,
      normalizationVersion: input.outcome.normalizationVersion,
      createdAt: input.now,
      updatedAt: input.now,
      retentionUntil: input.retentionUntil
    };
  }
}
