import { Injectable } from '@nestjs/common';
import type { Tenant } from '@saas-skeleton/database';

/**
 * Внески фіч у `GET /settings/bootstrap` (docs/modules.md §4). Settings нижче за фічі,
 * тому не знає ні їхніх прапорців, ні секцій: фіча реєструє своє сама в `onModuleInit`.
 *
 * - `flag` — прапорець у `features` (feature-gating SPA без нового ендпоінта): `ai`.
 * - `section` — ключ верхнього рівня з даними для першого рендера: `calendar`. Форму
 *   відповіді задає composition root контрактів (`libs/contracts/src/bootstrap.schema.ts`),
 *   і відповідь проходить через неї — секція без ключа в схемі туди не потрапить.
 *
 * Немає фічі у форку — немає реєстрації, а її рядок прибирається з root-схеми.
 */
@Injectable()
export class BootstrapRegistry {
  private readonly flags = new Map<string, () => Promise<boolean>>();
  private readonly sections = new Map<string, (organization: Tenant) => unknown>();

  flag(name: string, resolve: () => Promise<boolean>): void {
    if (this.flags.has(name)) {
      throw new Error(`Bootstrap feature flag "${name}" is already registered`);
    }
    this.flags.set(name, resolve);
  }

  /** Секція рахується з уже прочитаного рядка організації — без зайвого запиту */
  section(name: string, resolve: (organization: Tenant) => unknown): void {
    if (this.sections.has(name)) {
      throw new Error(`Bootstrap section "${name}" is already registered`);
    }
    this.sections.set(name, resolve);
  }

  /** Рахується на кожен bootstrap — у tenant-контексті запиту */
  async resolveFlags(): Promise<Record<string, boolean>> {
    const entries = await Promise.all(
      [...this.flags].map(async ([name, resolve]) => [name, await resolve()] as const),
    );
    return Object.fromEntries(entries);
  }

  resolveSections(organization: Tenant): Record<string, unknown> {
    return Object.fromEntries(
      [...this.sections].map(([name, resolve]) => [name, resolve(organization)]),
    );
  }
}
