import { Injectable } from '@nestjs/common';
import type { Prisma } from '@saas-skeleton/database';

export interface CreatedTenant {
  id: string;
  /** Перший адмін — створюється в тій самій транзакції, що й тенант */
  admin: { id: string; name: string | null; email: string };
}

/**
 * Що модуль-фіча робить, коли в control plane зʼявляється тенант (docs/modules.md §4,
 * docs/module-registries.md R6). Той самий патерн, що `UserLifecycleHooks` у tenant-api:
 * хук виконується В ТІЙ САМІЙ транзакції, що створює тенанта і його першого адміна, — помилка
 * хука відкочує створення. Для того, що є частиною появи тенанта (дефолтний канал чату), а не
 * наслідком після неї.
 *
 * Транзакція — system-клієнта (BYPASSRLS): `tenantId` у хуку завжди явний.
 */
export interface TenantCreatedHook {
  onTenantCreated(tx: Prisma.TransactionClient, tenant: CreatedTenant): Promise<void>;
}

/**
 * Реєстр хуків появи тенанта. `tenants` — платформа, фічі він не імпортує: фіча імпортує
 * `TenantsModule` і реєструється сама в `onModuleInit`. Немає фічі — немає рядка реєстрації.
 */
@Injectable()
export class TenantLifecycleHooks {
  private readonly created = new Map<string, TenantCreatedHook>();

  /** `id` — назва модуля і причини; двічі той самий id — помилка зборки модулів */
  onCreated(id: string, hook: TenantCreatedHook): void {
    if (this.created.has(id)) {
      throw new Error(`Tenant-created hook "${id}" is already registered`);
    }
    this.created.set(id, hook);
  }

  /** Послідовно, у порядку реєстрації: хуки ділять одну транзакцію */
  async runCreated(tx: Prisma.TransactionClient, tenant: CreatedTenant): Promise<void> {
    for (const hook of this.created.values()) {
      await hook.onTenantCreated(tx, tenant);
    }
  }
}
