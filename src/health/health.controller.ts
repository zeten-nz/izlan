import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';
import { Public } from '../auth/http/decorators';

/**
 * Liveness (§18) — process tirikligi; har chaqiruvda DB query talab qilmaydi.
 * Readiness (§18) — DB reachability; ishlamasa 503. Internal detallar (host/user/URL) OSHKOR ETILMAYDI.
 */
@Public() // health/readiness global AuthGuard'dan ozod (§16)
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('health')
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async readiness(): Promise<{ status: string; database: string }> {
    const up = await this.health.isDatabaseUp();
    if (!up) {
      throw new ServiceUnavailableException({ status: 'unavailable', database: 'down' });
    }
    return { status: 'ready', database: 'up' };
  }
}
