import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * HealthService — infrastructure connectivity check.
 * Domain jadvallariga bog'liq emas — seed'dan oldin ham ishlaydi (§20).
 * Read-only: hech qanday insert/update (§52).
 */
@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async isDatabaseUp(): Promise<boolean> {
    try {
      // Parametrsiz literal — string interpolation YO'Q (§20).
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
