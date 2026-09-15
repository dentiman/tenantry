import { Module } from '@nestjs/common';
import { AuthModule } from '../auth.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';

/**
 * Окремий модуль-сусід AuthModule (не всередині нього) — той самий прийом, що
 * UsersModule/AccountModule: RealtimeModule сам імпортує AuthModule, тому
 * AuthModule → RealtimeModule дав би цикл.
 */
@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [PasswordResetController],
  providers: [PasswordResetService],
})
export class PasswordResetModule {}
