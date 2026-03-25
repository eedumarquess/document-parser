import { ExtractionWarning, JobStatus } from '@document-parser/shared-kernel';
import { ProcessingOutcomePolicy } from '../../src/domain/policies/processing-outcome.policy';
import { RetryPolicyService } from '../../src/domain/policies/retry-policy.service';

describe('ProcessingOutcomePolicy', () => {
  const policy = new ProcessingOutcomePolicy();

  it('marks a clean payload as COMPLETED', () => {
    expect(policy.decide({ payload: 'texto consolidado', warnings: [] })).toBe(JobStatus.COMPLETED);
  });

  it('marks payloads with illegible marker as PARTIAL', () => {
    expect(policy.decide({ payload: '[ilegivel]', warnings: [] })).toBe(JobStatus.PARTIAL);
  });

  it('marks payloads with warnings as PARTIAL', () => {
    expect(policy.decide({ payload: 'texto', warnings: [ExtractionWarning.ILLEGIBLE_CONTENT] })).toBe(JobStatus.PARTIAL);
  });
});

describe('RetryPolicyService', () => {
  const policy = new RetryPolicyService();

  it('retries while attempts are below the cap', () => {
    expect(policy.shouldRetry(1)).toBe(true);
    expect(policy.shouldRetry(2)).toBe(true);
    expect(policy.shouldRetry(3)).toBe(false);
  });

  it('calculates exponential backoff', () => {
    expect(policy.calculateDelayMs(1)).toBe(2000);
    expect(policy.calculateDelayMs(2)).toBe(4000);
  });
});
