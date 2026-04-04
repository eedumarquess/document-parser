import { RuntimeResourceRegistry } from '@document-parser/shared-infrastructure';
import { RuntimeResourceShutdownService } from '../../src/application/services/runtime-resource-shutdown.service';

describe('RuntimeResourceShutdownService', () => {
  it('closes registered runtime resources only once', async () => {
    const closeCalls: string[] = [];
    const runtimeResources = new RuntimeResourceRegistry();
    runtimeResources.register({
      async close(): Promise<void> {
        closeCalls.push('mongo');
      }
    });
    runtimeResources.register({
      async close(): Promise<void> {
        closeCalls.push('publisher');
      }
    });

    const service = new RuntimeResourceShutdownService(runtimeResources);

    await service.onApplicationShutdown();
    await service.onApplicationShutdown();

    expect(closeCalls.sort()).toEqual(['mongo', 'publisher']);
  });
});
