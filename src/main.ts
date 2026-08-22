import 'reflect-metadata';
import 'dotenv/config'; // .env → process.env (bootstrap validateEnv ConfigModule'dan oldin). Prod'da .env yo'q bo'lsa jim.
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { validateEnv } from './config/env.validation';
import { AuthExceptionFilter } from './auth/http/auth-exception.filter';
import { createFastifyAdapter } from './bootstrap/http-adapter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const env = validateEnv(process.env); // fail-fast (§11)

  // Ordinary API body ceiling stays at 1 MiB; ONLY the two bulk-import routes are raised to 5 MiB at the Fastify
  // body-parser boundary (TD-253). One shared factory keeps production and e2e wiring identical.
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createFastifyAdapter({ trustProxy: env.trustProxy }));
  const config = app.get(ConfigService);

  // Refresh cookie `cookie` paketi bilan controller boundary'da o'qiladi/yoziladi (cookie.util).
  // Signed cookie ISHLATILMAYDI — refresh token yuqori entropiya + server-side hash bilan himoyalangan (§28).

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  // DTO validation (§17): whitelist + forbidNonWhitelisted (noma'lum maydonlar rad).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  // Domain error → HTTP mapping (§40) — leak/enumeration-safe.
  app.useGlobalFilters(new AuthExceptionFilter());

  // Credentialed CORS (§34): exact allowlist only, credentials=true; wildcard+credentials YO'Q.
  if (env.corsOrigins.length > 0) {
    app.enableCors({ origin: env.corsOrigins, credentials: true });
  }

  await app.listen({ port: env.port, host: env.host });
  logger.log(`Izlan backend ready — env=${config.get('nodeEnv')} — http://${env.host}:${env.port}/api`);
}

bootstrap().catch((err) => {
  new Logger('Bootstrap').error('Application failed to start', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
