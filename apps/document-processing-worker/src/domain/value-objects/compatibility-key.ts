export class CompatibilityKey {
  public static build(input: {
    hash: string;
    requestedMode: string;
    pipelineVersion: string;
    outputVersion: string;
  }): string {
    return [input.hash, input.requestedMode, input.pipelineVersion, input.outputVersion].join(':');
  }
}
