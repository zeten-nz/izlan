import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  const controllerWith = (isUp: boolean) =>
    new HealthController({ isDatabaseUp: async () => isUp } as unknown as HealthService);

  it('liveness returns { status: ok } without DB (§18)', () => {
    expect(controllerWith(true).liveness()).toEqual({ status: 'ok' });
  });

  it('readiness returns ready when DB up', async () => {
    expect(await controllerWith(true).readiness()).toEqual({ status: 'ready', database: 'up' });
  });

  it('readiness maps DB failure to 503 (§39)', async () => {
    await expect(controllerWith(false).readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('HealthService', () => {
  it('isDatabaseUp true when ping resolves', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ x: 1 }]) };
    const svc = new HealthService(prisma as never);
    expect(await svc.isDatabaseUp()).toBe(true);
  });

  it('isDatabaseUp false when ping rejects', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('down')) };
    const svc = new HealthService(prisma as never);
    expect(await svc.isDatabaseUp()).toBe(false);
  });
});
