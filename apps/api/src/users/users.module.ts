import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // AUTH-1: зміна пароля і деактивація відкликають сесії (AuthSessionService) і
  // рвуть живі socket-и (RealtimeEmitter). Циклу немає: обидва модулі доменних
  // не імпортують
  imports: [AuthModule, RealtimeModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
