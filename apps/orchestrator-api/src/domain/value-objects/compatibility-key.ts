export class CompatibilityKey {
  public static build(input: {
    hash: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
  }): string {
    // CompatibilityKey is strictly an idempotency/reuse token for MVP result lookup.
    // It must not absorb template semantics while Template Management stays inactive.
    return [input.hash, input.requestedMode, input.pipelineVersion, input.outputVersion].join(':');
  }
}
