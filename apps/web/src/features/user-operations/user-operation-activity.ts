import type { UserOperationResponse } from '@saas-skeleton/contracts';
import type { ActivityItem, ActivityStatus } from '../../lib/activity';

const STATUS: Record<UserOperationResponse['status'], ActivityStatus> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled',
};

export interface OperationActions {
  cancel: (id: string) => void;
  dismiss: (id: string) => void;
  download: (id: string) => void;
}

export interface OperationTexts {
  /** Підпис кроку `userOperations.<type>.steps.<key>` */
  step: (type: string, key: string) => string;
  /** Текст коду помилки */
  error: (code: string) => string;
  download: string;
}

/**
 * Операція користувача як елемент лотка активності (`lib/activity.ts`). Чиста функція: стан
 * приходить із REST (`GET /user-operations/:id`), сокет лише каже, коли його перечитати.
 */
export function toActivityItem(
  operation: UserOperationResponse,
  actions: OperationActions,
  texts: OperationTexts,
): ActivityItem {
  const active = operation.status === 'QUEUED' || operation.status === 'RUNNING';
  return {
    id: operation.id,
    title: operation.title,
    status: STATUS[operation.status],
    progress: active && operation.progress ? operation.progress : undefined,
    steps: operation.steps?.map((step) => ({
      key: step.key,
      label: texts.step(operation.type, step.key),
      status: step.status,
      current: step.current,
      total: step.total,
    })),
    errorMessage: operation.errorCode ? texts.error(operation.errorCode) : undefined,
    startedAt: Date.parse(operation.createdAt),
    action:
      operation.status === 'SUCCEEDED' && operation.hasResultFile
        ? {
            label: texts.download,
            run: () => {
              actions.download(operation.id);
            },
          }
        : undefined,
    // Скасування, яке вже попрошено, не пропонуємо вдруге: воркер зупиниться на контрольній точці
    onCancel:
      active && !operation.cancelRequested
        ? () => {
            actions.cancel(operation.id);
          }
        : undefined,
    onDismiss: () => {
      actions.dismiss(operation.id);
    },
  };
}

/**
 * Чи перечитувати операцію за сокет-подією: лише коли ревізія новіша за відому. Подія без
 * стану (правило 15 AGENTS.md), тож старіша чи та сама ревізія нічого нового не несе.
 */
export function isNewerRevision(known: number | undefined, announced: number): boolean {
  return known === undefined || announced > known;
}
