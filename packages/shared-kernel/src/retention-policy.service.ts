import { ArtifactType } from './enums';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export class RetentionPolicyService {
  public calculateOriginalRetentionUntil(now: Date): Date {
    return addDays(now, 30);
  }

  public calculateTelemetryRetentionUntil(now: Date): Date {
    return addDays(now, 30);
  }

  public calculateAuditRetentionUntil(now: Date): Date {
    return addDays(now, 180);
  }

  public calculateDeadLetterRetentionUntil(now: Date): Date {
    return addDays(now, 180);
  }

  public calculateProcessingResultRetentionUntil(now: Date): Date {
    return addDays(now, 90);
  }

  public calculateQueuePublicationOutboxRetentionUntil(now: Date): Date {
    return addDays(now, 7);
  }

  public calculatePageArtifactRetentionUntil(input: { artifactType: ArtifactType; now: Date }): Date {
    if (input.artifactType === ArtifactType.OCR_JSON) {
      return addDays(input.now, 90);
    }

    return addDays(input.now, 30);
  }
}

function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_IN_MS);
}
