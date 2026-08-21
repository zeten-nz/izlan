import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation';

/**
 * Global config boundary. `validate` startup'da env'ni tekshiradi (fail-fast).
 * Qaytargan typed obyekt kalitlari (nodeEnv, host, port, databaseUrl, ...) ConfigService orqali olinadi.
 * Application kodi process.env'ga bevosita murojaat qilmaydi (§13).
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
