import { Injectable } from '@nestjs/common';
import {
  ArtifactType,
  DEFAULT_MODEL_VERSION,
  DEFAULT_NORMALIZATION_VERSION,
  DEFAULT_PROMPT_VERSION,
  JobStatus,
  TransientFailureError,
  FatalFailureError,
  type ProcessingOutcome
} from '@document-parser/shared-kernel';
import type { ExtractionPipelinePort } from '../../../contracts/ports';
import { ProcessingOutcomePolicy } from '../../../domain/policies/processing-outcome.policy';

@Injectable()
export class SimulatedDocumentExtractionAdapter implements ExtractionPipelinePort {
  public constructor(private readonly outcomePolicy: ProcessingOutcomePolicy) {}

  public async extract(input: Parameters<ExtractionPipelinePort['extract']>[0]): Promise<ProcessingOutcome> {
    const rawText = input.original.toString('utf8').trim();

    if (rawText.includes('[[TRANSIENT_FAILURE]]')) {
      throw new TransientFailureError('Simulated transient failure');
    }
    if (rawText.includes('[[FATAL_FAILURE]]')) {
      throw new FatalFailureError('Simulated fatal failure');
    }

    const fallbackUsed = rawText.includes('[[LLM]]');
    const cleanedText = rawText
      .replaceAll('[[LLM]]', '')
      .replaceAll('[[ILLEGIBLE]]', '[ilegível]')
      .trim();
    const payload = cleanedText === '' ? '[ilegível]' : cleanedText;
    const warnings = payload.includes('[ilegível]') ? ['ILLEGIBLE_CONTENT'] : [];
    const status = this.outcomePolicy.decide({ payload, warnings });
    const maskedText = payload.replaceAll(/\d/g, '*');

    return {
      status,
      engineUsed: fallbackUsed ? 'OCR+LLM' : 'OCR',
      confidence: status === JobStatus.COMPLETED ? 0.98 : 0.62,
      warnings,
      payload,
      fallbackUsed,
      promptVersion: fallbackUsed ? DEFAULT_PROMPT_VERSION : undefined,
      modelVersion: fallbackUsed ? DEFAULT_MODEL_VERSION : undefined,
      normalizationVersion: DEFAULT_NORMALIZATION_VERSION,
      totalLatencyMs: fallbackUsed ? 2200 : 900,
      artifacts: [
        {
          artifactId: `artifact-render-${input.job.jobId}`,
          artifactType: ArtifactType.RENDERED_IMAGE,
          storageBucket: 'artifacts',
          storageObjectKey: `render/${input.job.jobId}/page-1.png`,
          mimeType: 'image/png',
          pageNumber: 1
        },
        {
          artifactId: `artifact-ocr-${input.job.jobId}`,
          artifactType: ArtifactType.OCR_JSON,
          storageBucket: 'artifacts',
          storageObjectKey: `ocr/${input.job.jobId}/page-1.json`,
          mimeType: 'application/json',
          pageNumber: 1,
          metadata: { payloadLength: payload.length }
        },
        {
          artifactId: `artifact-masked-${input.job.jobId}`,
          artifactType: ArtifactType.MASKED_TEXT,
          storageBucket: 'artifacts',
          storageObjectKey: `masked/${input.job.jobId}/payload.txt`,
          mimeType: 'text/plain',
          metadata: { maskedText }
        }
      ]
    };
  }
}

