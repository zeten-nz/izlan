import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * DatabaseModule — PrismaService'ni eksport qiladi.
 * @Global qaror (§14): PrismaService cross-cutting infrastructure — har domain module ishlatadi;
 * global registratsiya takroriy import noise'ini yo'qotadi va "bitta managed Prisma boundary" (§33)
 * invariantini kuchaytiradi. Repository'lar bu yerda YARATILMAYDI (§32) — ular domain modullar bilan keladi.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
