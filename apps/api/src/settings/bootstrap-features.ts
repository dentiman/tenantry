import { Injectable } from '@nestjs/common';

/**
 * Прапорці `features` у `GET /settings/bootstrap` — feature-gating SPA без нового ендпоінта.
 *
 * Settings нижче за фічі, тому прапорців не знає: фіча реєструє свій сама в
 * `onModuleInit` (так робить `ai`, docs/modules.md §4). Немає фічі у форку — немає й
 * ключа, і фронтенд читає це як «вимкнено».
 */
@Injectable()
export class BootstrapFeatures {
  private readonly flags = new Map<string, () => Promise<boolean>>();

  register(name: string, resolve: () => Promise<boolean>): void {
    if (this.flags.has(name)) {
      throw new Error(`Bootstrap feature flag "${name}" is already registered`);
    }
    this.flags.set(name, resolve);
  }

  /** Рахується на кожен bootstrap — у tenant-контексті запиту */
  async resolve(): Promise<Record<string, boolean>> {
    const entries = await Promise.all(
      [...this.flags].map(async ([name, resolve]) => [name, await resolve()] as const),
    );
    return Object.fromEntries(entries);
  }
}
