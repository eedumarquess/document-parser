import { Injectable, OnApplicationShutdown, OnModuleDestroy } from '@nestjs/common';
import { RuntimeResourceRegistry } from '@document-parser/shared-infrastructure';

@Injectable()
export class RuntimeResourceShutdownService implements OnApplicationShutdown, OnModuleDestroy {
  public constructor(private readonly runtimeResources: RuntimeResourceRegistry) {}

  public async onApplicationShutdown(): Promise<void> {
    await this.runtimeResources.closeAll();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.runtimeResources.closeAll();
  }
}
