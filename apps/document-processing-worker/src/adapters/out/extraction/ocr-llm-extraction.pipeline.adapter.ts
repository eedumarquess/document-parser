import { Injectable } from '@nestjs/common';
import { FatalFailureError, TransientFailureError } from '@document-parser/shared-kernel';
import type { ExtractionPipelinePort } from '../../../contracts/ports';
import { FallbackResolutionStage } from './internal/fallback-resolution.stage';
import { OutcomeAssemblyStage } from './internal/outcome-assembly.stage';
import { PageExtractionStage } from './internal/page-extraction.stage';

@Injectable()
export class OcrLlmExtractionPipelineAdapter implements ExtractionPipelinePort {
  public constructor(
    private readonly pageExtractionStage: PageExtractionStage,
    private readonly fallbackResolutionStage: FallbackResolutionStage,
    private readonly outcomeAssemblyStage: OutcomeAssemblyStage
  ) {}

  public async extract(input: Parameters<ExtractionPipelinePort['extract']>[0]) {
    const originalText = input.original.toString('utf8');

    if (originalText.includes('[[TRANSIENT_FAILURE]]')) {
      throw new TransientFailureError('Deterministic extraction pipeline transient failure');
    }
    if (originalText.includes('[[FATAL_FAILURE]]')) {
      throw new FatalFailureError('Simulated fatal failure');
    }

    const extractedPages = await this.pageExtractionStage.extract({
      jobId: input.job.jobId,
      mimeType: input.document.mimeType,
      original: input.original,
      pageCount: input.document.pageCount
    });
    const resolvedFallbacks = await this.fallbackResolutionStage.resolve({
      jobId: input.job.jobId,
      renderedPages: extractedPages.renderedPages,
      pageExtractions: extractedPages.pageExtractions
    });

    return this.outcomeAssemblyStage.assemble({
      jobId: input.job.jobId,
      attemptId: input.attempt.attemptId,
      pageExtractions: resolvedFallbacks.pageExtractions,
      fallbackTargets: resolvedFallbacks.fallbackTargets,
      fallbackArtifacts: resolvedFallbacks.fallbackArtifacts
    });
  }
}
