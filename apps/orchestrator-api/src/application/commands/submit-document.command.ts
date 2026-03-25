export type SubmitDocumentCommand = {
  file: {
    originalName: string;
    mimeType: string;
    size: number;
    buffer: Buffer;
  };
  requestedMode: string;
  forceReprocess: boolean;
};

