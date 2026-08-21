import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [AuthorizationModule], // LEARNER role assign uchun
  providers: [UsersRepository, UsersService],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
