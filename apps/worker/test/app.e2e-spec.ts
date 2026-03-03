import { Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

@Injectable()
class TestWorkerService {
  ping() {
    return 'pong';
  }
}

@Module({
  providers: [TestWorkerService],
  exports: [TestWorkerService],
})
class TestWorkerModule {}

describe('Worker (e2e)', () => {
  it('creates app context', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestWorkerModule],
    }).compile();

    const service = moduleFixture.get(TestWorkerService);
    expect(service.ping()).toBe('pong');
    await moduleFixture.close();
  });
});
