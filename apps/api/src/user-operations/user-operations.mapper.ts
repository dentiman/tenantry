import type { UserOperation } from '@saas-skeleton/database';
import type {
  UserOperationErrorCode,
  UserOperationResponse,
  UserOperationStep,
} from '@saas-skeleton/contracts';

/**
 * Рядок → відповідь. `resultKey` назовні не йде (ключ сховища не віддаємо — лише прапорець
 * `hasResultFile`), `params` теж: у фільтрах може бути пошуковий рядок, а відповідь читає
 * лише власник, якому вони й так відомі.
 */
export function toUserOperationResponse(row: UserOperation): UserOperationResponse {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    status: row.status,
    progress:
      row.progressCurrent !== null && row.progressTotal !== null
        ? { current: row.progressCurrent, total: row.progressTotal }
        : null,
    steps: (row.steps as UserOperationStep[] | null) ?? null,
    revision: row.revision,
    result: (row.result as Record<string, unknown> | null) ?? null,
    hasResultFile: row.resultKey !== null,
    errorCode: (row.errorCode as UserOperationErrorCode | null) ?? null,
    cancelRequested: row.cancelRequestedAt !== null,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
