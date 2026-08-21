import { Module } from '@nestjs/common';
import { AuthorizationRepository } from './authorization.repository';
import { AuthorizationService } from './authorization.service';

@Module({
  providers: [AuthorizationRepository, AuthorizationService],
  exports: [AuthorizationRepository, AuthorizationService],
})
export class AuthorizationModule {}
