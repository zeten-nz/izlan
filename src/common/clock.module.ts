import { Module } from '@nestjs/common';
import { Clock } from './clock';

/** Shared wall-clock provider (one instance; test override applies everywhere). */
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
