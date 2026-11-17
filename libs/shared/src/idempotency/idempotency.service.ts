import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Prisma, PrismaService, TenantTransactions } from '@saas-skeleton/database';

const CONTEXT_KEY = 'idempotencyRequest';

/** Ключ поточного HTTP-запиту; живе в CLS від interceptor-а до кінця обробника */
export interface IdempotencyRequestContext {
  readonly key: string;
  readonly userId: string;
  readonly operation: string;
  readonly requestHash: string;
  /** Транзакція, що вже вставила рядок: повторний `claim` у ній нічого не робить */
  claimedIn?: Prisma.TransactionClient;
  /** true лише після КОМІТУ транзакції, яка зайняла ключ */
  committed: boolean;
}

export interface StoredIdempotencyKey {
  requestHash: string;
  /** null — ефект закомічено, але відповідь ще не записана (або втрачена) */
  responseStatus: number | null;
  responseBody: unknown;
}

/**
 * Внутрішній сигнал, не помилка для клієнта: рядок із цим ключем уже закомічено іншим запитом.
 * Кидається з `claim`, відкочує транзакцію (у ній ще нічого не записано) і ловиться
 * `IdempotencyInterceptor`-ом, який віддає збережену відповідь першого запиту.
 */
export class IdempotencyKeyTakenSignal extends Error {
  constructor() {
    super('Idempotency key is already taken by a committed request');
    this.name = 'IdempotencyKeyTakenSignal';
  }
}

/**
 * Ідемпотентність REST-мутацій за заголовком `Idempotency-Key` (docs/idempotency.md).
 *
 * Головне правило — ключ комітиться РАЗОМ з ефектом: `claim(tx)` вставляє рядок у транзакції
 * сервісу. Тому видимий рядок ⇔ ефект застосовано, і після падіння процесу не буває стану
 * «ключ зайнято, що сталося — невідомо». Той самий прийом, що `MessageInboxService.runOnce`
 * для споживачів черги; тут він захищає вхід з HTTP.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantTx: TenantTransactions,
    private readonly cls: ClsService,
  ) {}

  /**
   * Зайняти ключ поточного запиту. Викликається ПЕРШИМ стейтментом у `withTenantTx`
   * верхньорівневого методу сервісу — до будь-яких блокувань (лічильник нумерації).
   *
   * Без ключа в контексті (запит без заголовка, виклик із воркера чи сіда) — нічого не робить,
   * тож той самий метод сервісу працює всюди.
   *
   * Паралельний дублікат: його INSERT чекає на унікальному індексі, доки перша транзакція не
   * завершиться. Коміт → `count === 0` → сигнал; відкат → рядка немає, цей запит виконується сам.
   */
  async claim(tx: Prisma.TransactionClient): Promise<void> {
    const context = this.current();
    if (!context || context.claimedIn === tx) {
      return;
    }
    const { count } = await tx.idempotencyKey.createMany({
      data: [
        {
          userId: context.userId,
          key: context.key,
          operation: context.operation,
          requestHash: context.requestHash,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) {
      throw new IdempotencyKeyTakenSignal();
    }
    context.claimedIn = tx;
    // Кидає, якщо tx не з withTenantTx, — саме те, що треба: ключ поза транзакцією ефекту
    // нічого не гарантує
    this.tenantTx.onCommit(tx, () => {
      context.committed = true;
    });
  }

  // ---- для IdempotencyInterceptor; доменний код цього не викликає ----

  begin(
    request: Pick<IdempotencyRequestContext, 'key' | 'userId' | 'operation' | 'requestHash'>,
  ): IdempotencyRequestContext {
    const context: IdempotencyRequestContext = { ...request, committed: false };
    this.cls.set(CONTEXT_KEY, context);
    return context;
  }

  end(): void {
    if (this.cls.isActive()) {
      this.cls.set(CONTEXT_KEY, undefined);
    }
  }

  /** Tenant-межу дає RLS; у межах тенанта ключ належить користувачу */
  async find(userId: string, key: string): Promise<StoredIdempotencyKey | null> {
    return this.prisma.idempotencyKey.findFirst({
      where: { userId, key },
      select: { requestHash: true, responseStatus: true, responseBody: true },
    });
  }

  /**
   * Зберегти відповідь першого запиту. Окремий UPDATE після коміту: тіло відповіді будує
   * контролер, коли транзакція сервісу вже завершена.
   */
  async saveResponse(
    context: IdempotencyRequestContext,
    status: number,
    body: unknown,
  ): Promise<void> {
    await this.prisma.idempotencyKey.updateMany({
      where: { userId: context.userId, key: context.key, responseStatus: null },
      data: {
        responseStatus: status,
        // Рівно те, що піде в мережу: без undefined-полів і з уже серіалізованими датами
        responseBody:
          body === undefined
            ? Prisma.DbNull
            : (JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue),
        completedAt: new Date(),
      },
    });
  }

  private current(): IdempotencyRequestContext | undefined {
    return this.cls.isActive()
      ? this.cls.get<IdempotencyRequestContext | undefined>(CONTEXT_KEY)
      : undefined;
  }
}
