import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ChatModule } from '../chat/chat.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // AUTH-1: зміна пароля і деактивація відкликають сесії (AuthSessionService) і
  // рвуть живі socket-и (RealtimeEmitter). Циклу немає: обидва модулі доменних
  // не імпортують
  // ChatModule — новий юзер вступає в дефолтний канал тією ж транзакцією,
  // що й створюється (DefaultChannelService)
  imports: [AuthModule, RealtimeModule, ChatModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
