import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
// Subpath-імпорт: головний index libs/shared тягне pg-boss/@aws-sdk, непотрібні platform-api
import { AppThrottlerGuard } from '@saas-skeleton/shared/auth/throttler';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthSessionService } from './platform-auth-session.service';
import { PlatformJwtGuard } from './guards/platform-jwt.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        // ОКРЕМИЙ секрет — security boundary між plane-ами: без фолбека на JWT_SECRET,
        // спільний секрет зробив би токени крос-валідними
        secret: config.getOrThrow<string>('PLATFORM_JWT_SECRET'),
        signOptions: {
          // AUTH-2: 15 хв, як tenant-api (було 60m без refresh — MVP MT-3)
          expiresIn: config.get('PLATFORM_JWT_ACCESS_EXPIRES_IN', '15m'),
        },
      }),
    }),
  ],
  controllers: [PlatformAuthController],
  providers: [
    PlatformAuthService,
    PlatformAuthSessionService,
    {
      provide: APP_GUARD,
      useClass: PlatformJwtGuard,
    },
    {
      // AUTH-2: ПІСЛЯ PlatformJwtGuard — ліміт «на оператора» бере req.operator.sub
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
  exports: [PlatformAuthService, PlatformAuthSessionService],
})
export class PlatformAuthModule {}
