import { Injectable } from '@nestjs/common';
import type { Prisma } from '@saas-skeleton/database';

export interface CreatedUser {
  id: string;
  name: string | null;
  email: string;
}

/**
 * Що модуль вище по графу робить, коли в тенанті зʼявляється юзер (docs/modules.md §4).
 *
 * Хук виконується В ТІЙ САМІЙ транзакції, що створює юзера (`tx` першим аргументом —
 * docs/backend-conventions.md §3): помилка хука відкочує й саме створення. Це для того,
 * що є частиною появи людини, а не наслідком після неї (членство в дефолтному каналі
 * чату). Наслідок, який має статися потім і може повторюватися — `publish(tx,
 * userRegisteredEvent)` з підписником у worker, а не хук.
 */
export interface UserCreatedHook {
  onUserCreated(tx: Prisma.TransactionClient, user: CreatedUser): Promise<void>;
}

/**
 * Реєстр хуків появи юзера. `users` нижче за фічі, тому не імпортує їх: фіча імпортує
 * `UsersModule` і реєструється сама в `onModuleInit`. Немає фічі у форку — немає й
 * рядка реєстрації.
 */
@Injectable()
export class UserLifecycleHooks {
  private readonly created = new Map<string, UserCreatedHook>();

  /** `id` — назва модуля і причини; двічі той самий id — помилка зборки модулів */
  onCreated(id: string, hook: UserCreatedHook): void {
    if (this.created.has(id)) {
      throw new Error(`User-created hook "${id}" is already registered`);
    }
    this.created.set(id, hook);
  }

  /** Послідовно, у порядку реєстрації: хуки ділять одну транзакцію */
  async runCreated(tx: Prisma.TransactionClient, user: CreatedUser): Promise<void> {
    for (const hook of this.created.values()) {
      await hook.onUserCreated(tx, user);
    }
  }
}
