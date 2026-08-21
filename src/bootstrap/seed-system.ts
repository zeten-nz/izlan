import 'reflect-metadata';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuthorizationRepository } from '../authorization/authorization.repository';
import { bootstrapSystemRoles } from './system-roles';

/**
 * Controlled system seed entrypoint (§7). FAQAT system role identity — demo user/content YO'Q.
 * `npm run db:seed:system`. Idempotent.
 */
async function main(): Promise<void> {
  const logger = new Logger('SeedSystem');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const authz = app.get(AuthorizationRepository);
    await bootstrapSystemRoles(authz);
    logger.log('System roles bootstrapped (LEARNER, METHODIST, MODERATOR, ADMIN)');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  new Logger('SeedSystem').error('Seed failed', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
