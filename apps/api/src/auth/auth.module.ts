import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSessionService } from './auth-session.service';
import { AccessTokenService } from './access-token.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AppThrottlerGuard } from '@saas-skeleton/shared';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get('JWT_ACCESS_EXPIRES_IN', '15m'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthSessionService,
    AccessTokenService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      // ПІСЛЯ JwtAuthGuard — порядок guard-ів дорівнює порядку реєстрації,
      // і RolesGuard читає request.user, який кладе перший
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      // AUTH-0: ПІСЛЯ JwtAuthGuard — ліміт «на користувача» бере req.user.sub.
      // Публічні роути (логін, refresh) Jwt пропускає, тож їх ліміт спрацьовує до хендлера
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
  // AccessTokenService експортується для RealtimeModule: socket-middleware перевіряє
  // токен ТИМ САМИМ кодом, що HTTP-guard
  // AuthSessionService експортується для account/users: відкликання сесій —
  // частина їхніх доменних транзакцій (зміна пароля, деактивація, revoke-all)
  exports: [AuthService, AuthSessionService, AccessTokenService],
})
export class AuthModule {}
