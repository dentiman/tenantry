import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  // Доменну логіку не дублюємо — переюзаємо сервіси обох модулів (обидва їх експортують)
  imports: [UsersModule, AuthModule, RealtimeModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
