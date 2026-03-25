import type { ProcessingJobRequestedMessage } from '@document-parser/shared-kernel';

export type ProcessJobMessageCommand = {
  message: ProcessingJobRequestedMessage;
};

