import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: jest.Mocked<HealthService>;

  beforeEach(() => {
    healthService = {
      check: jest.fn(),
    } as unknown as jest.Mocked<HealthService>;
    controller = new HealthController(healthService);
  });

  it('returns 200-compatible payload when healthy', async () => {
    healthService.check.mockResolvedValue({
      status: 'ok',
      postgres: true,
      rabbitmq: true,
      timestamp: '2026-03-03T00:00:00.000Z',
    });
    const response = { status: jest.fn() } as any;

    const result = await controller.getHealth(response);

    expect(result.status).toBe('ok');
    expect(response.status).not.toHaveBeenCalled();
  });

  it('sets response status to 503 when unhealthy', async () => {
    healthService.check.mockResolvedValue({
      status: 'error',
      postgres: false,
      rabbitmq: true,
      timestamp: '2026-03-03T00:00:00.000Z',
    });
    const response = { status: jest.fn() } as any;

    const result = await controller.getHealth(response);

    expect(result.status).toBe('error');
    expect(response.status).toHaveBeenCalledWith(503);
  });
});
