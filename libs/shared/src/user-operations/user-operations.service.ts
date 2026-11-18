import { Injectable } from '@nestjs/common';
import {
  Prisma,
  TenantContextService,
  TenantTransactions,
  type UserOperation,
} from '@saas-skeleton/database';
import {
  USER_OPERATION_DEFINITIONS,
  type UserOperationErrorCode,
  type UserOperationStep,
  type UserOperationType,
} from '@saas-skeleton/contracts';
import { NotificationRecorder } from '../notifications/notification-recorder.service';
import { UserOperationEventsRegistry } from './user-operation-events';

export interface StartUserOperationInput {
  type: UserOperationType;
  userId: string;
  title: string;
  params: unknown;
}

/** Що змінити разом із переходом; `revision` і перевірку стану додає сам сервіс */
type TransitionData = Omit<Prisma.UserOperationUpdateManyMutationInput, 'revision' | 'status'>;

/**
 * Дані й переходи операції користувача (docs/user-operations.md). Власник таблиці
 * `user_operations`: інші модулі створюють операції лише через `start(tx, …)`, а змінюють — через
 * runner (воркер) або `requestCancel` (API).
 *
 * Кожен перехід — умовний `updateMany` з очікуваним поточним станом і `revision + 1`
 * (backend-conventions §4). Тому пізній записувач (повтор job-а після STALLED, прогрес після
 * скасування) нічого не змінює, а фінальний стан не перезаписується ніколи.
 */
@Injectable()
export class UserOperationsService {
  constructor(
    private readonly tenantTx: TenantTransactions,
    private readonly tenantContext: TenantContextService,
    private readonly notifications: NotificationRecorder,
    private readonly events: UserOperationEventsRegistry,
  ) {}

  /**
   * Створити операцію в стані QUEUED. Викликається в транзакції доменного методу, який у тій
   * самій транзакції публікує команду свого типу (`publish(tx, …, { userOperationId })`), —
   * операція і job зʼявляються разом або не зʼявляються зовсім.
   */
  async start(tx: Prisma.TransactionClient, input: StartUserOperationInput): Promise<UserOperation> {
    const params = USER_OPERATION_DEFINITIONS[input.type].params.parse(input.params) as Prisma.InputJsonValue;
    const operation = await tx.userOperation.create({
      data: { type: input.type, userId: input.userId, title: input.title, params },
    });
    this.emitAfterCommit(tx, operation);
    return operation;
  }

  /**
   * Скасувати на прохання власника. QUEUED → CANCELED одразу (job, коли дійде, побачить це й
   * нічого не робитиме); RUNNING → прапорець, воркер зупиниться на найближчій контрольній точці.
   * Фінальний стан не змінюється. null — операції немає або вона чужа.
   */
  async requestCancel(id: string, userId: string): Promise<UserOperation | null> {
    return this.tenantTx.withTenantTx(async (tx) => {
      const queued = await tx.userOperation.updateMany({
        where: { id, userId, status: 'QUEUED' },
        data: { status: 'CANCELED', finishedAt: new Date(), revision: { increment: 1 } },
      });
      if (queued.count === 0) {
        await tx.userOperation.updateMany({
          where: { id, userId, status: 'RUNNING', cancelRequestedAt: null },
          data: { cancelRequestedAt: new Date(), revision: { increment: 1 } },
        });
      }
      const current = await tx.userOperation.findFirst({ where: { id, userId } });
      if (current) {
        this.emitAfterCommit(tx, current);
      }
      return current;
    });
  }

  // ------------------------------------------------------- переходи воркера

  /**
   * Перехід, обмежений очікуваним станом і (для RUNNING) токеном захоплення `startedAt`: другий
   * виконавець, що перехопив завислу операцію, отримує новий `startedAt`, і записи першого більше
   * не збігаються. Повертає оновлений рядок або null, якщо умова не виконалась.
   */
  async transition(
    tx: Prisma.TransactionClient,
    where: Prisma.UserOperationWhereInput & { id: string },
    status: UserOperation['status'] | undefined,
    data: TransitionData,
  ): Promise<UserOperation | null> {
    const { count } = await tx.userOperation.updateMany({
      where,
      data: { ...data, ...(status && { status }), revision: { increment: 1 } },
    });
    if (count === 0) {
      return null;
    }
    const row = await tx.userOperation.findUniqueOrThrow({ where: { id: where.id } });
    this.emitAfterCommit(tx, row);
    return row;
  }

  /** Завершити з помилкою (з будь-якого нефінального стану) — разом зі сповіщенням власника */
  async fail(
    tx: Prisma.TransactionClient,
    where: Prisma.UserOperationWhereInput & { id: string },
    errorCode: UserOperationErrorCode,
  ): Promise<UserOperation | null> {
    const row = await this.transition(tx, where, 'FAILED', { errorCode, finishedAt: new Date() });
    if (row) {
      await this.notifications.notify(tx, {
        type: 'user_operation.failed',
        recipientIds: [row.userId],
        actor: { type: 'system' },
        payload: { operation: this.ref(row), type: row.type, errorCode },
        target: { kind: 'user_operation', id: row.id },
      });
    }
    return row;
  }

  /** Сповіщення про успіх; викликається в транзакції переходу в SUCCEEDED */
  async notifySucceeded(tx: Prisma.TransactionClient, row: UserOperation): Promise<void> {
    await this.notifications.notify(tx, {
      type: 'user_operation.succeeded',
      recipientIds: [row.userId],
      actor: { type: 'system' },
      payload: { operation: this.ref(row), type: row.type },
      target: { kind: 'user_operation', id: row.id },
    });
  }

  /** Записати прогрес/кроки/heartbeat поза транзакцією (воркер, під tenant-контекстом) */
  async writeProgress(
    id: string,
    claimToken: Date,
    data: { current?: number; total?: number; steps?: UserOperationStep[] },
  ): Promise<{ cancelRequested: boolean } | null> {
    return this.tenantTx.withTenantTx(async (tx) => {
      const row = await this.transition(
        tx,
        { id, status: 'RUNNING', startedAt: claimToken },
        undefined,
        {
          heartbeatAt: new Date(),
          ...(data.current !== undefined && { progressCurrent: data.current }),
          ...(data.total !== undefined && { progressTotal: data.total }),
          ...(data.steps !== undefined && { steps: data.steps }),
        },
      );
      return row ? { cancelRequested: row.cancelRequestedAt !== null } : null;
    });
  }

  private ref(row: UserOperation): { kind: string; id: string; label: string } {
    return { kind: 'user_operation', id: row.id, label: row.title };
  }

  private emitAfterCommit(tx: Prisma.TransactionClient, row: UserOperation): void {
    const tenantId = this.tenantContext.requireTenantId();
    this.tenantTx.onCommit(tx, () => {
      this.events.changed(tenantId, row.userId, { id: row.id, revision: row.revision });
    });
  }
}
