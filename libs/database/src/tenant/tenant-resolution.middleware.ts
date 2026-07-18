import { Injectable, NestMiddleware, Optional } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { TenantContextService } from './tenant-context.service';
import { TenantResolver } from './tenant-resolver';

type Next = (error?: unknown) => void;

/**
 * Піднімає CLS-контекст на КОЖЕН запит (включно з @Public() — login/refresh теж
 * потребують tenant-а) і кладе в нього tenantId з резолвера. Сам створює cls.run —
 * окремий ClsMiddleware не потрібен, отже немає і проблеми порядку двох middleware.
 * JwtAuthGuard далі ЗВІРЯЄ tenantId з токена проти резолвленого і перезаписує контекст.
 */
@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly cls: ClsService,
    private readonly tenantContext: TenantContextService,
    @Optional() private readonly resolver?: TenantResolver,
  ) {}

  use(req: unknown, _res: unknown, next: Next): void {
    this.cls.run(() => {
      if (!this.resolver) {
        next();
        return;
      }
      this.resolver
        .resolve(req as { headers: Record<string, string | string[] | undefined>; body?: unknown })
        .then(({ tenantId, authoritative }) => {
          if (tenantId) {
            this.tenantContext.set(tenantId);
          }
          this.tenantContext.setResolutionAuthoritative(authoritative);
          next();
        })
        .catch((error: unknown) => {
          next(error);
        });
    });
  }
}
