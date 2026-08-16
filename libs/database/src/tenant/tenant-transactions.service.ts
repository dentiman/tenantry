import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PRISMA_BASE } from './tokens';
import type { PrismaService } from '../prisma.service';
import { TenantContextService } from './tenant-context.service';

/** Побічний ефект, який має сенс лише після успішного коміту (емісія в socket, метрика) */
export type AfterCommitHook = () => void | Promise<void>;

/**
 * Реєстр хуків, ключ — САМ обʼєкт транзакційного клієнта. WeakMap, а не CLS:
 * привʼязка виходить явною і неможливо зареєструвати хук «не в ту» транзакцію,
 * навіть коли їх дві вкладені. Записи чистяться в finally, weak-посилання —
 * страховка від витоку, якщо хтось колись обійде цей шлях.
 */
const AFTER_COMMIT_HOOKS = new WeakMap<Prisma.TransactionClient, AfterCommitHook[]>();

/**
 * Інтерактивні транзакції під tenant-контекстом: перший стейтмент — set_config,
 * далі fn на тому самому конекшені. Єдиний легальний спосіб відкрити транзакцію
 * в доменному коді (голий prisma.$transaction обходить tenant-extension і
 * заборонений ESLint-ом).
 */
@Injectable()
export class TenantTransactions {
  private readonly logger = new Logger(TenantTransactions.name);

  constructor(
    @Inject(PRISMA_BASE) private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async withTenantTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const tenantId = this.tenantContext.getTenantId() ?? '';
    const hooks: AfterCommitHook[] = [];

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
      AFTER_COMMIT_HOOKS.set(tx, hooks);
      try {
        return await fn(tx);
      } finally {
        AFTER_COMMIT_HOOKS.delete(tx);
      }
    });

    // Сюди потрапляємо ТІЛЬКИ після успішного COMMIT: якщо fn або сам коміт упали,
    // $transaction відхиляється вище і жоден хук не виконується.
    for (const hook of hooks) {
      try {
        await hook();
      } catch (error) {
        // Побічний ефект не має права «відмінити» вже закомічену бізнес-операцію.
        // Тому лог, а не throw: socket-емісія — прискорення, джерело правди в БД
        this.logger.warn(
          `After-commit hook failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return result;
  }

  /**
   * Відкласти побічний ефект до коміту. Реєструється в тому ж місці, де пишеться
   * рядок (див. NotificationRecorder), тому «забути емісію» неможливо, а
   * «емітнути до коміту» — тим паче: клієнт пішов би за списком і не побачив рядка.
   *
   * Кидає, якщо tx не з `withTenantTx`: це баг викликача, а не дані.
   */
  onCommit(tx: Prisma.TransactionClient, hook: AfterCommitHook): void {
    const hooks = AFTER_COMMIT_HOOKS.get(tx);
    if (!hooks) {
      throw new Error(
        'onCommit() called outside withTenantTx — after-commit hooks are bound to a transaction',
      );
    }
    hooks.push(hook);
  }
}
