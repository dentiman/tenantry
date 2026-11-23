import i18n from 'i18next';
import type { UserOperationResponse } from '@saas-skeleton/contracts';
import { parseApiError } from '@saas-skeleton/ui/api/api-error';
import { runtimeKey } from '@saas-skeleton/ui/lib/i18n-keys';
import { showApiErrorToast } from '@saas-skeleton/ui/lib/error-toast';
import {
  userOperationsCancel,
  userOperationsFindAll,
  userOperationsFindOne,
  userOperationsResultUrl,
} from '../../api/generated/api';
import { useActivityStore } from '../../lib/activity';
import { isNewerRevision, toActivityItem } from './user-operation-activity';

/**
 * Джерело лотка активності для операцій користувача (docs/frontend/app-shell.md §5.7). Тримає
 * останню відому ревізію кожної операції й публікує операції в реєстр `lib/activity.ts`.
 * Стан — завжди з REST; сокет лише підказує, що його треба перечитати.
 *
 * «Прибрати» — локальне рішення цієї вкладки: операція лишається на сервері до кінця строку
 * зберігання, але в лоток уже не повертається.
 */
const revisions = new Map<string, number>();
const dismissed = new Set<string>();

const texts = {
  // Ключі збираються в рантаймі з коду типу й кроку — типізованих літералів тут бути не може
  step: (type: string, key: string): string =>
    i18n.t(...runtimeKey(`user-operations:types.${type}.steps.${key}`)),
  error: (code: string): string => i18n.t(...runtimeKey(`user-operations:errors.${code}`)),
  get download(): string {
    return i18n.t('user-operations:actions.download');
  },
};

function reportError(error: unknown): void {
  showApiErrorToast(parseApiError(error));
}

/** Завантажити файл результату: посилання короткоживуче, тож беремо його в момент кліку */
export async function downloadUserOperationResult(id: string): Promise<void> {
  try {
    const { url } = await userOperationsResultUrl(id);
    // Content-Disposition: attachment — браузер завантажує файл, сторінка лишається на місці
    window.location.assign(url);
  } catch (error) {
    reportError(error);
  }
}

const actions = {
  cancel: (id: string): void => {
    userOperationsCancel(id).then(trackUserOperation, reportError);
  },
  dismiss: (id: string): void => {
    dismissed.add(id);
    useActivityStore.getState().remove(id);
  },
  download: (id: string): void => {
    void downloadUserOperationResult(id);
  },
};

/** Показати (або оновити) операцію в лотку; старіший знімок нічого не перезаписує */
export function trackUserOperation(operation: UserOperationResponse): void {
  const known = revisions.get(operation.id);
  if (known !== undefined && operation.revision < known) {
    return;
  }
  revisions.set(operation.id, operation.revision);
  if (dismissed.has(operation.id)) {
    return;
  }
  useActivityStore.getState().upsert(toActivityItem(operation, actions, texts));
}

/** Сокет: операція змінилась — перечитати, якщо ревізія новіша */
export async function onUserOperationChanged(id: string, revision: number): Promise<void> {
  if (!isNewerRevision(revisions.get(id), revision)) {
    return;
  }
  try {
    trackUserOperation(await userOperationsFindOne(id));
  } catch {
    // 404 — операцію прибрала чистка; подія лише прискорювач, мовчимо
  }
}

/** Після (пере)підключення сокета: активні операції з REST — пропущені події не мають значення */
export async function resyncActiveUserOperations(): Promise<void> {
  try {
    const { items } = await userOperationsFindAll({ active: 'true' });
    items.forEach(trackUserOperation);
  } catch {
    // Недоступний список — не привід для тоста: лоток просто без операцій до наступної спроби
  }
}
