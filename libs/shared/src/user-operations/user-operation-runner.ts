import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  PrismaService,
  TenantTransactions,
  type UserOperation,
} from '@saas-skeleton/database';
import {
  USER_OPERATION_DEFINITIONS,
  USER_OPERATION_STALL_MINUTES,
  type StepStatus,
  type UserOperationStep,
  type UserOperationType,
} from '@saas-skeleton/contracts';
import { NonRetryableMessageError } from '../messaging/messaging.errors';
import { shouldWriteProgress, type ProgressMark } from './progress-throttle';
import { UserOperationsService } from './user-operations.service';

/** Скасування, яке воркер побачив на контрольній точці; не помилка */
export class UserOperationCanceledSignal extends Error {
  constructor() {
    super('User operation was canceled');
    this.name = 'UserOperationCanceledSignal';
  }
}

/** Операцію перехопив інший виконавець або її вже завершено (STALLED) — цей мусить зупинитись */
export class UserOperationLostSignal extends Error {
  constructor() {
    super('User operation is no longer owned by this runner');
    this.name = 'UserOperationLostSignal';
  }
}

export interface UserOperationSuccess {
  /** Підсумок для `result` (без ключів сховища) */
  result: Record<string, unknown>;
  /** Ключ обʼєкта результату в S3, якщо є файл */
  resultKey?: string;
}

/** Що бачить обробник типу операції */
export interface UserOperationContext<TParams> {
  readonly operation: UserOperation;
  readonly params: TParams;
  /** Прогрес у одиницях типу (рядки, файли); пишеться з тротлінгом і заодно ловить скасування */
  progress(current: number, total: number): Promise<void>;
  /** Кидає `UserOperationCanceledSignal`, якщо власник попросив скасувати */
  checkpoint(): Promise<void>;
  /** Оголосити кроки (усі pending); далі `step(key, fn)` веде кожен */
  steps(keys: readonly string[]): Promise<void>;
  step<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export type UserOperationHandler<TParams> = (
  context: UserOperationContext<TParams>,
) => Promise<UserOperationSuccess>;

const STALL_MS = USER_OPERATION_STALL_MINUTES * 60 * 1000;

/**
 * Виконання операції у воркері (docs/user-operations.md §5). Обгортає обробник типу:
 *
 * 1. **Захоплення** QUEUED → RUNNING. Скасовану чи завершену — пропускає. RUNNING, що мовчить
 *    довше за поріг зависання, перехоплює (повтор job-а після падіння воркера); свіжу RUNNING —
 *    лишає (дубль доставки). Ідемпотентність дає саме захоплення, а не `runOnce`: експорт
 *    триває хвилини, а тримати транзакцію стільки заборонено (backend-conventions §5).
 * 2. **Робота** — обробник пише прогрес; кожен запис оновлює heartbeat і приносить прапорець
 *    скасування.
 * 3. **Завершення** — guarded-перехід разом зі сповіщенням в одній короткій транзакції.
 *
 * Помилки: `NonRetryableMessageError` або невалідні параметри → FAILED одразу; будь-яка інша
 * піде назовні, job повториться з backoff, а операція лишиться RUNNING і буде перехоплена за
 * heartbeat. Якщо повтори вичерпано — sweeper поставить FAILED/STALLED.
 */
@Injectable()
export class UserOperationRunner {
  private readonly logger = new Logger(UserOperationRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantTx: TenantTransactions,
    private readonly operations: UserOperationsService,
  ) {}

  async run<TParams>(
    operationId: string,
    type: UserOperationType,
    handler: UserOperationHandler<TParams>,
  ): Promise<'succeeded' | 'failed' | 'canceled' | 'skipped'> {
    const claimed = await this.claim(operationId);
    if (!claimed) {
      return 'skipped';
    }
    const token = claimed.startedAt;
    if (token === null) {
      throw new Error(`Claimed operation ${operationId} has no startedAt`);
    }
    const guard = { id: operationId, status: 'RUNNING' as const, startedAt: token };

    const parsed = USER_OPERATION_DEFINITIONS[type].params.safeParse(claimed.params);
    if (!parsed.success || claimed.type !== type) {
      await this.tenantTx.withTenantTx((tx) => this.operations.fail(tx, guard, 'INVALID_PARAMS'));
      return 'failed';
    }

    const context = this.createContext<TParams>(claimed, parsed.data as TParams, token);
    try {
      const success = await handler(context);
      const finished = await this.tenantTx.withTenantTx(async (tx) => {
        const row = await this.operations.transition(tx, guard, 'SUCCEEDED', {
          finishedAt: new Date(),
          heartbeatAt: new Date(),
          result: success.result as Prisma.InputJsonValue,
          resultKey: success.resultKey ?? null,
        });
        if (row) {
          await this.operations.notifySucceeded(tx, row);
        }
        return row;
      });
      return finished ? 'succeeded' : 'skipped';
    } catch (error) {
      if (error instanceof UserOperationCanceledSignal) {
        await this.tenantTx.withTenantTx((tx) =>
          this.operations.transition(tx, guard, 'CANCELED', { finishedAt: new Date() }),
        );
        return 'canceled';
      }
      if (error instanceof UserOperationLostSignal) {
        this.logger.warn(`Operation ${operationId} was taken over or finished elsewhere — stopping`);
        return 'skipped';
      }
      if (error instanceof NonRetryableMessageError) {
        await this.tenantTx.withTenantTx((tx) => this.operations.fail(tx, guard, 'INTERNAL'));
        return 'failed';
      }
      throw error;
    }
  }

  /** Захопити операцію; null — робити нічого не треба */
  private async claim(id: string): Promise<UserOperation | null> {
    return this.tenantTx.withTenantTx(async (tx) => {
      const now = new Date();
      const fresh = await this.operations.transition(tx, { id, status: 'QUEUED' }, 'RUNNING', {
        startedAt: now,
        heartbeatAt: now,
      });
      if (fresh) {
        return fresh;
      }
      // Повтор job-а після падіння: перехоплюємо лише ту RUNNING, що давно мовчить
      return this.operations.transition(
        tx,
        { id, status: 'RUNNING', heartbeatAt: { lt: new Date(now.getTime() - STALL_MS) } },
        undefined,
        { startedAt: now, heartbeatAt: now },
      );
    });
  }

  private createContext<TParams>(
    operation: UserOperation,
    params: TParams,
    token: Date,
  ): UserOperationContext<TParams> {
    let mark: ProgressMark | null = null;
    let cancelRequested = operation.cancelRequestedAt !== null;
    let steps: UserOperationStep[] = [];

    const write = async (data: Parameters<UserOperationsService['writeProgress']>[2]): Promise<void> => {
      const outcome = await this.operations.writeProgress(operation.id, token, data);
      if (!outcome) {
        throw new UserOperationLostSignal();
      }
      cancelRequested = outcome.cancelRequested;
    };

    const setStep = async (key: string, status: StepStatus): Promise<void> => {
      steps = steps.map((step) => (step.key === key ? { key, status } : step));
      await write({ steps });
    };

    const context: UserOperationContext<TParams> = {
      operation,
      params,
      progress: async (current, total) => {
        const now = Date.now();
        if (shouldWriteProgress(mark, now, current, total)) {
          mark = { at: now, current };
          await write({ current, total });
        }
        if (cancelRequested) {
          throw new UserOperationCanceledSignal();
        }
      },
      checkpoint: async () => {
        if (!cancelRequested) {
          // Свіжий погляд у БД: між записами прогресу власник міг натиснути «скасувати»
          const row = await this.prisma.userOperation.findUnique({
            where: { id: operation.id },
            select: { cancelRequestedAt: true },
          });
          cancelRequested = row?.cancelRequestedAt != null;
        }
        if (cancelRequested) {
          throw new UserOperationCanceledSignal();
        }
      },
      steps: async (keys) => {
        steps = keys.map((key) => ({ key, status: 'pending' }));
        await write({ steps });
      },
      step: async (key, fn) => {
        // Крок, виконаний у попередній спробі job-а, не повторюється — він і є контрольна точка
        const existing = (operation.steps as UserOperationStep[] | null)?.find((s) => s.key === key);
        if (existing?.status === 'done') {
          return undefined as never;
        }
        await setStep(key, 'running');
        try {
          const value = await fn();
          await setStep(key, 'done');
          return value;
        } catch (error) {
          if (!(error instanceof UserOperationCanceledSignal)) {
            await setStep(key, 'failed');
          }
          throw error;
        }
      },
    };
    return context;
  }
}
