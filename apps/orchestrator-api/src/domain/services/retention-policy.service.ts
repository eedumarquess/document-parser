export class RetentionPolicyService {
  public calculateOriginalRetentionUntil(now: Date): Date {
    return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }
}

