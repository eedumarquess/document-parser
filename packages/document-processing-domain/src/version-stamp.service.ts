import type { VersionStamp } from '@document-parser/shared-kernel';

export class VersionStampService {
  public buildJobStamp(input: Pick<VersionStamp, 'pipelineVersion' | 'outputVersion'>): Pick<
    VersionStamp,
    'pipelineVersion' | 'outputVersion'
  > {
    return {
      pipelineVersion: input.pipelineVersion,
      outputVersion: input.outputVersion
    };
  }

  public buildAttemptStamp(input: Pick<
    VersionStamp,
    'pipelineVersion' | 'normalizationVersion' | 'promptVersion' | 'modelVersion'
  >): Pick<VersionStamp, 'pipelineVersion' | 'normalizationVersion' | 'promptVersion' | 'modelVersion'> {
    return {
      pipelineVersion: input.pipelineVersion,
      normalizationVersion: input.normalizationVersion,
      promptVersion: input.promptVersion,
      modelVersion: input.modelVersion
    };
  }
}
