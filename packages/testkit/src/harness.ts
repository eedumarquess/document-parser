export type GoldenDatasetMeasurement = {
  precision: number;
  recall: number;
  f1: number;
  latencyMs: number;
};

export class GoldenDatasetHarness {
  public validate(metrics: GoldenDatasetMeasurement): void {
    if (metrics.precision <= 0 || metrics.recall <= 0 || metrics.f1 <= 0) {
      throw new Error('Golden dataset metrics must be positive');
    }
    if (metrics.latencyMs > 30_000) {
      throw new Error('Golden dataset latency exceeded 30 seconds');
    }
  }
}

