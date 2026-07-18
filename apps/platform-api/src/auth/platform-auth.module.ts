import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
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
          expiresIn: config.get('PLATFORM_JWT_ACCESS_EXPIRES_IN', '60m'),
        },
      }),
    }),
  ],
  controllers: [PlatformAuthController],
  providers: [
    PlatformAuthService,
    {
      provide: APP_GUARD,
      useClass: PlatformJwtGuard,
    },
  ],
  exports: [PlatformAuthService],
})
export class PlatformAuthModule {}
