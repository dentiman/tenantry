import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

const TENANT_ID_KEY = 'tenantId';
const RESOLUTION_AUTHORITATIVE_KEY = 'tenantResolutionAuthoritative';

/**
 * Єдина точка доступу до tenant-контексту запиту/джоби (обгортка над CLS).
 * Доменний код її НЕ інжектить (§6 плану мультитенантності) — споживачі:
 * інфраструктура (Prisma extension, черги, storage), auth і логери.
 */
@Injectable()
export class TenantContextService {
  constructor(private readonly cls: ClsService) {}

  getTenantId(): string | undefined {
    // isActive: поза контекстом (скрипти, системні джоби) cls.get кидав би — тут undefined
    return this.cls.isActive() ? this.cls.get<string | undefined>(TENANT_ID_KEY) : undefined;
  }

  requireTenantId(): string {
    const tenantId = this.getTenantId();
    if (!tenantId) {
      throw new Error('Tenant context is missing (no tenantId in CLS)');
    }
    return tenantId;
  }

  /** Виставити tenant у ВЖЕ активному контексті (middleware/guard/refresh-флоу) */
  set(tenantId: string): void {
    this.cls.set(TENANT_ID_KEY, tenantId);
  }

  /** Прапорець middleware-а: чи мусить guard звіряти tenantId токена з резолвленим */
  setResolutionAuthoritative(authoritative: boolean): void {
    this.cls.set(RESOLUTION_AUTHORITATIVE_KEY, authoritative);
  }

  isResolutionAuthoritative(): boolean {
    return this.cls.isActive()
      ? (this.cls.get<boolean | undefined>(RESOLUTION_AUTHORITATIVE_KEY) ?? false)
      : false;
  }

  /** Створити контекст і виконати fn у ньому (worker: tenantId із payload джоби) */
  runWith<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return this.cls.run(async () => {
      this.cls.set(TENANT_ID_KEY, tenantId);
      return fn();
    });
  }

  /** Контекст без tenant-а (системні джоби: щоб getTenantId давав undefined стабільно) */
  runWithout<T>(fn: () => Promise<T>): Promise<T> {
    return this.cls.run(fn);
  }
}
