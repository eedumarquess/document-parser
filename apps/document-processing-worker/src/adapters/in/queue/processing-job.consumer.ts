import { Injectable } from '@nestjs/common';
import type { ProcessingJobRequestedMessage } from '@document-parser/shared-kernel';
import { ProcessJobMessageUseCase } from '../../../application/use-cases/process-job-message.use-case';

@Injectable()
export class ProcessingJobConsumer {
  public constructor(private readonly processJobMessageUseCase: ProcessJobMessageUseCase) {}

  public async handle(message: ProcessingJobRequestedMessage): Promise<void> {
    await this.processJobMessageUseCase.execute({ message });
  }
}

