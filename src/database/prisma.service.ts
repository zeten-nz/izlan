import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * PrismaService — INFRASTRUCTURE only (§15).
 * Prisma 7 PostgreSQL driver adapter (@prisma/adapter-pg) orqali ulanadi (§4).
 * Bitta managed Prisma boundary per process (§33) — biror modul `new PrismaClient()` yaratmaydi.
 * Business query'lar (findUser/createLesson) bu yerda YO'Q — ular kelajakdagi repository'larda.
 * Pool ownership: PrismaPg({ connectionString }) pool'ni ichida boshqaradi; $disconnect() uni yopadi.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const connectionString = config.getOrThrow<string>('databaseUrl');
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }
}
