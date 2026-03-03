export interface DocumentProcessingMessage {
  version: number;
  documentId: string;
  storagePath: string;
  mimeType: string;
  attempt: number;
  correlationId: string;
  enqueuedAt: string;
}
