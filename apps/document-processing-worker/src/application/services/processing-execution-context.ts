import type { ProcessingJobRequestedMessage } from '@document-parser/shared-kernel';
import type { DocumentRecord, JobAttemptRecord, ProcessingJobRecord } from '../../contracts/models';

export type ProcessingMessageContext = {
  message: ProcessingJobRequestedMessage;
  job: ProcessingJobRecord;
  attempt: JobAttemptRecord;
  document: DocumentRecord;
};

export type PartialProcessingMessageContext = {
  message: ProcessingJobRequestedMessage;
  job?: ProcessingJobRecord;
  attempt?: JobAttemptRecord;
  document?: DocumentRecord;
};

export type ProcessingExecutionContext = ProcessingMessageContext & {
  original: Buffer;
};
