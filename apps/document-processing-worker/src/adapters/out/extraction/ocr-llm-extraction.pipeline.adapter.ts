import { Injectable } from '@nestjs/common';
import { FatalFailureError, TransientFailureError } from '@document-parser/shared-kernel';
import type {
  ExtractionPipelinePort,
  MetricsPort,
  TracingPort
} from '../../../contracts/ports';
import { FallbackResolutionStage } from './internal/fallback-resolution.stage';
import { OutcomeAssemblyStage } from './internal/outcome-assembly.stage';
import { PageExtractionStage } from './internal/page-extraction.stage';

@Injectable()
export class OcrLlmExtractionPipelineAdapter implements ExtractionPipelinePort {
  public constructor(
    private readonly pageExtractionStage: PageExtractionStage,
    private readonly fallbackResolutionStage: FallbackResolutionStage,
    private readonly outcomeAssemblyStage: OutcomeAssemblyStage,
    private readonly observability?: {
      metrics: MetricsPort;
      tracing: TracingPort;
    }
  ) {}

  public async extract(input: Parameters<ExtractionPipelinePort['extract']>[0]) {
    if (input.document.mimeType !== 'application/pdf') {
      const originalText = input.original.toString('utf8');

      if (originalText.includes('[[TRANSIENT_FAILURE]]')) {
        throw new TransientFailureError('Deterministic extraction pipeline transient failure');
      }
      if (originalText.includes('[[FATAL_FAILURE]]')) {
        throw new FatalFailureError('Simulated fatal failure');
      }
    }

    const extractedPages = await this.recordStage({
      traceId: input.traceId,
      jobId: input.job.jobId,
      documentId: input.document.documentId,
      attemptId: input.attempt.attemptId,
      operation: 'page_extraction',
      spanName: 'worker.page_extraction'
    }, () =>
      this.pageExtractionStage.extract({
        jobId: input.job.jobId,
        mimeType: input.document.mimeType,
        original: input.original,
        pageCount: input.document.pageCount
      })
    );
    const resolvedFallbacks = await this.recordStage({
      traceId: input.traceId,
      jobId: input.job.jobId,
      documentId: input.document.documentId,
      attemptId: input.attempt.attemptId,
      operation: 'fallback_resolution',
      spanName: 'worker.fallback_resolution'
    }, () =>
      this.fallbackResolutionStage.resolve({
        jobId: input.job.jobId,
        renderedPages: extractedPages.renderedPages,
        pageExtractions: extractedPages.pageExtractions
      })
    );

    return this.recordStage({
      traceId: input.traceId,
      jobId: input.job.jobId,
      documentId: input.document.documentId,
      attemptId: input.attempt.attemptId,
      operation: 'outcome_assembly',
      spanName: 'worker.outcome_assembly'
    }, async () =>
      this.outcomeAssemblyStage.assemble({
        jobId: input.job.jobId,
        attemptId: input.attempt.attemptId,
        pageExtractions: resolvedFallbacks.pageExtractions,
        fallbackTargets: resolvedFallbacks.fallbackTargets,
        fallbackArtifacts: resolvedFallbacks.fallbackArtifacts
      })
    );
  }

  private async recordStage<T>(input: {
    traceId: string;
    jobId: string;
    documentId: string;
    attemptId: string;
    operation: string;
    spanName: string;
  }, work: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();

    const execute = async () => {
      try {
        return await work();
      } finally {
        await this.observability?.metrics.recordHistogram({
          name: `worker.${input.operation}.duration_ms`,
          value: Date.now() - startedAt,
          traceId: input.traceId,
          tags: {
            operation: input.operation,
            jobId: input.jobId,
            documentId: input.documentId,
            attemptId: input.attemptId
          }
        });
      }
    };

    if (this.observability === undefined) {
      return execute();
    }

    return this.observability.tracing.runInSpan(
      {
        traceId: input.traceId,
        spanName: input.spanName,
        attributes: {
          jobId: input.jobId,
          documentId: input.documentId,
          attemptId: input.attemptId,
          operation: input.operation
        }
      },
      execute
    );
  }
}
