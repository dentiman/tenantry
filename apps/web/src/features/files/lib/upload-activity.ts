import type { StepProgressItem } from '@saas-skeleton/ui/components/step-progress';
import type { ActivityItem, ActivityStatus } from '../../../lib/activity';
import { isActiveUpload, type UploadEntry, type UploadPhase } from './upload-queue';

/** Три етапи двофазного завантаження, як їх бачить людина */
export type UploadStepKey = 'prepare' | 'transfer' | 'verify';

const STATUS: Record<UploadPhase, ActivityStatus> = {
  queued: 'queued',
  preparing: 'running',
  transferring: 'running',
  verifying: 'running',
  done: 'succeeded',
  failed: 'failed',
  canceled: 'canceled',
};

const ORDER: readonly UploadStepKey[] = ['prepare', 'transfer', 'verify'];

const STEP_OF_PHASE: Partial<Record<UploadPhase, UploadStepKey>> = {
  preparing: 'prepare',
  transferring: 'transfer',
  verifying: 'verify',
};

/** Етапи завантаження для `StepProgress`: що вже зроблено, що триває, на чому впало */
export function uploadSteps(
  entry: Pick<
    UploadEntry<unknown, unknown>,
    'phase' | 'loaded' | 'total' | 'failedPhase' | 'errorMessage'
  >,
  label: (key: UploadStepKey) => string,
): StepProgressItem[] {
  const current =
    entry.phase === 'failed' && entry.failedPhase
      ? STEP_OF_PHASE[entry.failedPhase]
      : STEP_OF_PHASE[entry.phase];
  const currentIndex = current ? ORDER.indexOf(current) : -1;

  return ORDER.map((key, index): StepProgressItem => {
    const base = { key, label: label(key) };
    if (entry.phase === 'done') {
      return { ...base, status: 'done' };
    }
    if (currentIndex === -1) {
      // queued або скасовано до старту — жоден етап не починався
      return { ...base, status: 'pending' };
    }
    if (index < currentIndex) {
      return { ...base, status: 'done' };
    }
    if (index > currentIndex) {
      return { ...base, status: 'pending' };
    }
    if (entry.phase === 'failed') {
      return { ...base, status: 'failed', description: entry.errorMessage };
    }
    return key === 'transfer'
      ? { ...base, status: 'running', current: entry.loaded, total: entry.total }
      : { ...base, status: 'running' };
  });
}

interface Actions {
  cancel: (id: string) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
}

/** Завантаження як елемент лотка активності (`lib/activity.ts`) */
export function toActivityItem(
  entry: UploadEntry<{ name: string }, unknown>,
  actions: Actions,
  label: (key: UploadStepKey) => string,
): ActivityItem {
  const active = isActiveUpload(entry.phase);
  return {
    id: entry.id,
    title: entry.source.name,
    status: STATUS[entry.phase],
    // Відсоток рахується за байтами: до початку передачі — нуль із повного розміру, щоб
    // файл у черзі чесно тягнув спільний відсоток униз
    progress: active ? { current: entry.loaded, total: entry.total } : undefined,
    steps: uploadSteps(entry, label),
    errorMessage: entry.errorMessage,
    startedAt: entry.startedAt,
    onCancel: active
      ? () => {
          actions.cancel(entry.id);
        }
      : undefined,
    // Повтор — лише там, де його попросив той, хто додав завантаження (design D4): екран, що
    // чекав на файл, уже отримав відмову й результат повтору нікуди не привʼяже
    onRetry:
      entry.phase === 'failed' && entry.retryable
        ? () => {
            actions.retry(entry.id);
          }
        : undefined,
    onDismiss: () => {
      if (active) {
        actions.cancel(entry.id);
      }
      actions.remove(entry.id);
    },
  };
}

interface UnloadTarget {
  addEventListener(type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void): void;
  removeEventListener(type: 'beforeunload', listener: (event: BeforeUnloadEvent) => void): void;
}

/**
 * Попередження браузера про вихід, поки є активні завантаження. Слухач висить ЛИШЕ в цей час:
 * постійний `beforeunload` вимикає back/forward-кеш сторінки.
 */
export function createLeaveGuard(target: UnloadTarget): (activeCount: number) => void {
  let attached = false;
  const listener = (event: BeforeUnloadEvent): void => {
    // Текст підказки браузер показує власний; достатньо скасувати подію
    event.preventDefault();
  };
  return (activeCount) => {
    if (activeCount > 0 && !attached) {
      target.addEventListener('beforeunload', listener);
      attached = true;
    } else if (activeCount === 0 && attached) {
      target.removeEventListener('beforeunload', listener);
      attached = false;
    }
  };
}
