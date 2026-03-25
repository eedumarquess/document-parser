import { JobStatus } from '@document-parser/shared-kernel';
import type { ProcessingResultRecord } from '../../contracts/models';

export class CompatibleResultReusePolicy {
  public shouldReuse(input: {
    compatibleResult?: ProcessingResultRecord;
    forceReprocess: boolean;
  }): boolean {
    return (
      !input.forceReprocess &&
      input.compatibleResult !== undefined &&
      input.compatibleResult.status !== JobStatus.FAILED
    );
  }
}
