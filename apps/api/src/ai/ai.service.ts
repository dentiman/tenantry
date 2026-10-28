import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService, TenantTransactions } from '@saas-skeleton/database';
import type { AiConversation, AiMessage, Prisma } from '@saas-skeleton/database';
import {
  AI_CONFIG,
  AiCancelChannel,
  AiMessageStateService,
  AiAvailabilityService,
  AiUsageQuotaService,
  MessagePublisher,
  PostgresKnowledgeStore,
  citationsFor,
  generateAiReplyCommand,
  type AiConfig,
} from '@saas-skeleton/shared';
import {
  AI_MESSAGE_LIMIT_CODE,
  AI_QUOTA_EXCEEDED_CODE,
  REALTIME_EVENTS,
  type AiCitationContentResponse,
  type AiConversationChanged,
  type AiConversationListQuery,
} from '@saas-skeleton/contracts';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { RealtimeEmitter } from '../realtime/realtime.emitter';

/** Скільки останніх повідомлень віддавати панелі за один раз */
const TRANSCRIPT_LIMIT = 100;

/**
 * Курсор історії — непрозорий base64url("{lastMessageAt ISO}|{id}"), той самий keyset,
 * що в списку розмов чату: клієнт його не розбирає.
 */
function encodeHistoryCursor(lastMessageAt: Date, id: string): string {
  return Buffer.from(`${lastMessageAt.toISOString()}|${id}`).toString('base64url');
}

function decodeHistoryCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) {
    return null;
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  const at = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (sep === -1 || Number.isNaN(at.getTime()) || !id) {
    throw new BadRequestException('Invalid cursor');
  }
  return { at, id };
}

export type AiConversationWithTitle = AiConversation & {
  lastMessageAt: Date;
  firstQuestion: string | undefined;
};

/**
 * Розмова з асистентом. Дві межі, і вони РІЗНІ:
 *
 * - межу ТЕНАНТА тримає RLS (міграція `ai_assistant_conversations`);
 * - межу ЛЮДИНИ тримає цей сервіс — кожен запит фільтрується по `userId` з
 *   токена. Те саме рішення, що для приватних каналів чату і приватних подій
 *   календаря: «RLS — межа тенанта, а не учасника», тож ADMIN тут прав не має.
 *
 * Чужа (або неіснуюча) розмова дає 404, а не 403: 403 підтвердив би, що вона є.
 */
@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TenantTransactions,
    private readonly publisher: MessagePublisher,
    private readonly cancelChannel: AiCancelChannel,
    private readonly state: AiMessageStateService,
    private readonly realtime: RealtimeEmitter,
    private readonly usageQuota: AiUsageQuotaService,
    private readonly knowledgeStore: PostgresKnowledgeStore,
    private readonly availability: AiAvailabilityService,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
  ) {}

  /**
   * Гейт доступності (AI-5a, design.md D6): `AI_ENABLED` інсталяції, вмикач платформи,
   * дозвіл tenant-у й вибір Tenant Admin. Перше, що робить кожен роут; 403 без
   * розрізнення рівня — панель однаково зникає за `features.ai`.
   */
  async assertEnabled(): Promise<void> {
    if (!(await this.availability.forCurrentTenant()).available) {
      throw new ForbiddenException('AI assistant is not available for this tenant');
    }
  }

  /**
   * Активна розмова зі стрічкою; створюється на вимогу при першому зверненні.
   * Гонку двох вкладок вирішує не перевірка тут, а частковий унікальний індекс
   * у БД: той, хто програв, читає рядок переможця через `createMany`+`findActive`
   * (design.md D5) — без ловлі винятку в перерваній транзакції.
   *
   * Перед читанням стрічки закриваються ПОКИНУТІ відповіді (design.md D3): інакше
   * реплика, чию генерацію ніхто не довів до кінця, показувала б «у роботі» вічно.
   */
  async currentConversation(
    actor: JwtPayload,
  ): Promise<{ conversation: AiConversation; messages: AiMessage[] }> {
    const existing = await this.findActive(actor.sub);
    const conversation = existing ?? (await this.createActive(actor.sub));

    await this.transactions.withTenantTx(async (tx) => {
      const closed = await this.state.closeAbandoned(tx, conversation.id);
      if (closed > 0) {
        this.transactions.onCommit(tx, () => {
          this.emitConversationChanged(
            conversation.tenantId,
            actor.sub,
            conversation.id,
            'reply-closed',
          );
        });
      }
    });

    return { conversation, messages: await this.transcript(conversation.id) };
  }

  /**
   * Історія розмов юзера, свіжі згори. Лише розмови з хоч одним питанням: `reset()`
   * заводить порожню ACTIVE щоразу, і без цього фільтра історія наповнювалась би
   * «New conversation» без змісту. Межа людини — явний `userId`, як і скрізь у сервісі.
   */
  async listConversations(
    actor: JwtPayload,
    query: AiConversationListQuery,
  ): Promise<{ items: AiConversationWithTitle[]; nextCursor: string | null }> {
    const cursor = decodeHistoryCursor(query.cursor);
    const rows = await this.prisma.aiConversation.findMany({
      where: {
        userId: actor.sub,
        lastMessageAt: { not: null },
        ...(cursor && {
          OR: [
            { lastMessageAt: { lt: cursor.at } },
            { lastMessageAt: cursor.at, id: { lt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: {
        messages: {
          where: { role: 'USER' },
          orderBy: { seq: 'asc' },
          take: 1,
          select: { content: true },
        },
      },
    });

    const hasMore = rows.length > query.limit;
    const items = (hasMore ? rows.slice(0, query.limit) : rows).flatMap(
      ({ messages, ...conversation }) =>
        conversation.lastMessageAt
          ? [
              {
                ...conversation,
                lastMessageAt: conversation.lastMessageAt,
                firstQuestion: messages[0]?.content,
              },
            ]
          : [],
    );
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeHistoryCursor(last.lastMessageAt, last.id) : null,
    };
  }

  /**
   * Розмова з історії за id — активна чи RETIRED. Чужа або неіснуюча — 404, як і в
   * `cancel`/`citation`: існування чужої розмови не розкривається. Покинуті відповіді
   * закриваються так само, як у `currentConversation()`, — інакше RETIRED-розмова, чию
   * відповідь воркер уже не візьме, показувала б «у роботі» до наступного читання.
   */
  async conversationById(
    actor: JwtPayload,
    id: string,
  ): Promise<{ conversation: AiConversation; messages: AiMessage[] }> {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id, userId: actor.sub },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.transactions.withTenantTx(async (tx) => {
      const closed = await this.state.closeAbandoned(tx, conversation.id);
      if (closed > 0) {
        this.transactions.onCommit(tx, () => {
          this.emitConversationChanged(
            conversation.tenantId,
            actor.sub,
            conversation.id,
            'reply-closed',
          );
        });
      }
    });

    return { conversation, messages: await this.transcript(conversation.id) };
  }

  /**
   * «Продовжити розмову» з історії: вона стає ACTIVE, поточна — RETIRED. Правило «одна
   * активна на юзера» не змінюється, тож `ask()`, `reset()` і воркер працюють як були.
   *
   * Обидва кроки в одній транзакції (частковий унікальний індекс не дає двом ACTIVE
   * співіснувати навіть на мить), порядок — спершу прибрати поточну. Порожня поточна
   * (щойно після `reset()`) видаляється, а не ховається в RETIRED: в історії її однаково
   * не видно, а рядок лише чекав би на ретенцію. `ask()` бере лок рядка розмови, тож
   * питання, що встигло раніше, робить `lastMessageAt` не-null, і DELETE її пропускає.
   *
   * Перевірка «ціль RETIRED і моя» — умовний `updateMany` + `count`, а не попереднє
   * читання. Дві конкурентні активації РІЗНИХ розмов: друга або побачить уже нову
   * ACTIVE і прибере її, або вріжеться в частковий унікальний індекс → P2002 → 409.
   * В обох випадках активна рівно одна.
   */
  async activate(
    actor: JwtPayload,
    id: string,
  ): Promise<{ conversation: AiConversation; messages: AiMessage[] }> {
    const conversation = await this.transactions.withTenantTx(async (tx) => {
      const target = await tx.aiConversation.findFirst({ where: { id, userId: actor.sub } });
      if (!target) {
        throw new NotFoundException('Conversation not found');
      }
      if (target.status === 'ACTIVE') {
        return target; // уже активна — no-op, а не помилка
      }

      await tx.aiConversation.deleteMany({
        where: { userId: actor.sub, status: 'ACTIVE', lastMessageAt: null },
      });
      await tx.aiConversation.updateMany({
        where: { userId: actor.sub, status: 'ACTIVE' },
        data: { status: 'RETIRED' },
      });
      const { count } = await tx.aiConversation.updateMany({
        where: { id, userId: actor.sub, status: 'RETIRED' },
        data: { status: 'ACTIVE' },
      });
      if (count === 0) {
        // Ціль зникла між читанням і записом (паралельне «видалити мої розмови»)
        throw new NotFoundException('Conversation not found');
      }

      this.transactions.onCommit(tx, () => {
        this.emitConversationChanged(target.tenantId, actor.sub, target.id, 'activated');
      });
      return { ...target, status: 'ACTIVE' as const };
    });

    return { conversation, messages: await this.transcript(conversation.id) };
  }

  /**
   * Питання. Усе — питання, порожня відповідь і публікація команди — в ОДНІЙ
   * транзакції: або факт і його робота зафіксувались разом, або не сталося нічого.
   *
   * Порядок кроків навмисний (ai-1d design.md D3/D4, і design.md D3/D5 попередніх фаз):
   *  0. перевірка квоти ПЕРШОЮ — до того, як з'явиться хоч один рядок питання/відповіді
   *     чи job у черзі (ai-1d);
   *  1. UPDATE розмови (бере її рядковий лок — конкурентні `ask()` серіалізуються);
   *  2. закрити покинуті відповіді — мертва відповідь не має тримати «зайнято» вічно;
   *  3. лише ТЕПЕР перевірити «зайнято» і створити нове питання/відповідь.
   */
  async ask(
    actor: JwtPayload,
    text: string,
  ): Promise<{ conversation: AiConversation; question: AiMessage; reply: AiMessage }> {
    return this.transactions.withTenantTx(async (tx) => {
      // Крок 0 (ai-1d, design.md D3/D4): оптимістична перевірка — перевищити можна
      // рівно на один хід, що вже минув цю перевірку. Рядка ще немає жодного —
      // відмова тут означає, що job ніколи не потрапить у чергу
      const exceeded = await this.usageQuota.checkQuota(tx, actor.tenantId, actor.sub, new Date());
      if (exceeded) {
        const message = 'AI usage quota exceeded for the current period';
        throw new BadRequestException({
          message,
          fieldErrors: [{ field: 'text', message, code: AI_QUOTA_EXCEEDED_CODE }],
        });
      }

      // Крок 0b: добовий ліміт ПИТАНЬ (демо). Резерв атомарний і лежить у цій самій транзакції —
      // відмова нижче (409 «зайнято») відкотить і його. Токенну квоту вище це не замінює
      if (!(await this.usageQuota.reserveMessage(tx, actor.tenantId, actor.sub, new Date()))) {
        const message = 'Daily AI message limit reached for the current period';
        throw new BadRequestException({
          message,
          fieldErrors: [{ field: 'text', message, code: AI_MESSAGE_LIMIT_CODE }],
        });
      }

      const conversation =
        (await this.findActive(actor.sub, tx)) ?? (await this.createActive(actor.sub, tx));

      // Крок 1: лок рядка розмови ПЕРШИМ — це і є арбітр гонки двох конкурентних
      // ask() в тій самій розмові (замість перегонів до унікального індексу `seq`)
      await tx.aiConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });

      // Крок 2: покинута відповідь — не привід тримати розмову зайнятою
      const closed = await this.state.closeAbandoned(tx, conversation.id);

      const last = await tx.aiMessage.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { seq: 'desc' },
        select: { seq: true, role: true, status: true },
      });

      // «Зайнята» — це стан ОСТАННЬОЇ відповіді, а не окремий прапорець:
      // менше станів, які можуть розійтися між собою
      if (
        last?.role === 'ASSISTANT' &&
        (last.status === 'PENDING' || last.status === 'STREAMING')
      ) {
        throw new ConflictException('A reply is still being generated in this conversation');
      }

      const nextSeq = (last?.seq ?? -1) + 1;
      const question = await tx.aiMessage.create({
        data: {
          conversationId: conversation.id,
          seq: nextSeq,
          role: 'USER',
          status: 'COMPLETE',
          content: text,
          completedAt: new Date(),
        },
      });
      const reply = await tx.aiMessage.create({
        data: {
          conversationId: conversation.id,
          seq: nextSeq + 1,
          role: 'ASSISTANT',
          status: 'PENDING',
          content: '',
          // Оренда з моменту створення (design.md D3): якщо жодна доставка job-у
          // так і не захопить рядок, він закриється сам на наступному читанні,
          // а не триматиме розмову «зайнятою» вічно
          leaseExpiresAt: new Date(Date.now() + this.config.pendingTimeoutMs),
        },
      });

      // `group` — це справедливість між тенантами: pg-boss не дасть одному
      // тенанту зайняти більше воркерів, ніж `groupConcurrency` у маніфесті.
      // `actor` передається явно, як і в решті продюсерів: CLS-контекст ланцюга
      // на HTTP-вході порожній, і без цього конверт поїхав би від системи
      await this.publisher.publish(
        tx,
        generateAiReplyCommand,
        { conversationId: conversation.id, messageId: reply.id },
        {
          actor: { type: 'user', id: actor.sub, label: actor.email },
          group: { id: actor.tenantId },
        },
      );

      if (closed > 0) {
        this.transactions.onCommit(tx, () => {
          this.emitConversationChanged(
            conversation.tenantId,
            actor.sub,
            conversation.id,
            'reply-closed',
          );
        });
      }
      // Інші вкладки того самого юзера не бачать нового рядка інакше (design.md D7,
      // фікс §6.3): дельта прийде лише туди, де відповідь уже в кеші, а перше
      // питання ходу дельти не має взагалі
      this.transactions.onCommit(tx, () => {
        this.emitConversationChanged(
          conversation.tenantId,
          actor.sub,
          conversation.id,
          'turn-created',
        );
      });

      return { conversation, question, reply };
    });
  }

  /**
   * «Нова розмова»: стара стає RETIRED і лишається в БД — скидається КОНТЕКСТ,
   * а не історія. Обидві дії в одній транзакції, бо частковий унікальний індекс
   * не дозволить двом ACTIVE співіснувати навіть на мить.
   */
  async reset(actor: JwtPayload): Promise<{ conversation: AiConversation; messages: AiMessage[] }> {
    const conversation = await this.transactions.withTenantTx(async (tx) => {
      await tx.aiConversation.updateMany({
        where: { userId: actor.sub, status: 'ACTIVE' },
        data: { status: 'RETIRED' },
      });
      const created = await this.createActive(actor.sub, tx);
      this.transactions.onCommit(tx, () => {
        this.emitConversationChanged(created.tenantId, actor.sub, created.id, 'reset');
      });
      return created;
    });
    return { conversation, messages: [] };
  }

  /**
   * Зупинити генерацію. Успіх і тоді, коли відповідь уже завершилась: скасувати
   * завершене — за специфікацією no-op, а не помилка.
   *
   * Stop — ФАКТ У БД РАНІШЕ за pub/sub-сигнал (design.md D4): для `PENDING` це
   * фінальне й миттєве `CANCELLED` (claim() у воркері такий рядок більше не
   * знайде), для `STREAMING` — маркер `cancelRequestedAt`, і сигнал швидкого
   * шляху публікується лише тоді, коли маркер дійсно поставлено на живому рядку.
   */
  /**
   * Текст цитати (AI-2a.3, design.md D8). Чужа/неіснуюча відповідь, номер, на який
   * текст не посилається, або фрагмент, що вже неопублікований чи невидимий ПОТОЧНІЙ
   * ролі, — однаково 404: нічого з цього не розкривається окремо.
   */
  async citation(
    actor: JwtPayload,
    messageId: string,
    n: number,
  ): Promise<AiCitationContentResponse> {
    const message = await this.prisma.aiMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { select: { userId: true } } },
    });
    if (message?.conversation.userId !== actor.sub) {
      throw new NotFoundException('Message not found');
    }
    const ref = citationsFor(message.content, message.knowledgeChunks).find(
      (citation) => citation.n === n,
    );
    // Роль — з БД, а не з токена: доступ перевіряється на момент відкриття
    const user = await this.prisma.user.findUnique({
      where: { id: actor.sub },
      select: { role: true },
    });
    const text =
      ref && user
        ? await this.knowledgeStore.findCitation({
            chunkId: ref.chunkId,
            sourceKey: ref.sourceKey,
            contentHash: ref.contentHash,
            role: user.role,
          })
        : null;
    if (!ref || !text) {
      throw new NotFoundException('Citation not found');
    }
    return { n, title: text.title, heading: text.heading, path: text.path, content: text.content };
  }

  async cancel(actor: JwtPayload, messageId: string): Promise<void> {
    const message = await this.prisma.aiMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { select: { userId: true } } },
    });
    // Чужа або неіснуюча — однаково 404: існування чужої розмови не розкривається
    if (message?.conversation.userId !== actor.sub) {
      throw new NotFoundException('Message not found');
    }
    if (message.status !== 'PENDING' && message.status !== 'STREAMING') {
      return;
    }

    const cancelledPending = await this.transactions.withTenantTx(async (tx) => {
      const cancelled = await this.state.cancelPending(tx, messageId);
      if (cancelled) {
        this.transactions.onCommit(tx, () => {
          this.emitConversationChanged(
            message.tenantId,
            actor.sub,
            message.conversationId,
            'reply-closed',
          );
        });
      }
      return cancelled;
    });
    if (cancelledPending) {
      return;
    }

    // Рядок уже STREAMING (не PENDING, інакше крок вище б спрацював): записуємо
    // маркер і лише за успіху публікуємо швидкий сигнал — на термінальному рядку
    // (worker встиг фіналізувати між нашими двома читаннями) публікувати нічого
    const marked = await this.transactions.withTenantTx((tx) =>
      this.state.requestCancel(tx, messageId),
    );
    if (marked) {
      await this.cancelChannel.requestCancel(messageId);
    }
  }

  /**
   * «Видалити мої розмови» (ai-1e, docs/ai-assistant.md §9.2): негайний, жорсткий DELETE
   * усіх розмов юзера, без черги. Межа тенанта — RLS (tenantTx), межа людини — явний
   * `userId`, як і скрізь у цьому сервісі (клас-коментар); `AiMessage` каскадиться разом
   * з розмовою. Нову активну розмову тут НЕ створюємо — наступний `ask()`/читання
   * лінькво заведе її так само, як для юзера, що ще ніколи не питав (design.md D5)
   */
  async deleteAllConversations(actor: JwtPayload): Promise<void> {
    await this.transactions.withTenantTx(async (tx) => {
      await tx.aiConversation.deleteMany({ where: { userId: actor.sub } });
      this.transactions.onCommit(tx, () => {
        this.emitConversationChanged(actor.tenantId, actor.sub, null, 'deleted');
      });
    });
  }

  private async findActive(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<AiConversation | null> {
    const client = tx ?? this.prisma;
    return client.aiConversation.findFirst({ where: { userId, status: 'ACTIVE' } });
  }

  /**
   * `createMany` + `skipDuplicates` — Postgres `INSERT ... ON CONFLICT DO NOTHING`
   * (design.md D5). На відміну від `create()` + catch(P2002), тут НІЧОГО не кидає,
   * тож транзакція не переривається: unique violation у Postgres обриває саму
   * транзакцію, і читання одразу після неї без rollback/savepoint не відновило б
   * її (docs/notes/ai-assistant-review-gaps.md п.4).
   */
  private async createActive(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<AiConversation> {
    const client = tx ?? this.prisma;
    await client.aiConversation.createMany({
      data: [{ userId, status: 'ACTIVE' }],
      skipDuplicates: true,
    });
    const conversation = await this.findActive(userId, tx);
    if (!conversation) {
      // Неможливо за конструкцією: або ми, або конкурент щойно вставили ACTIVE-рядок
      throw new Error(
        `AiService.createActive: no active conversation for user ${userId} after insert`,
      );
    }
    return conversation;
  }

  private async transcript(conversationId: string): Promise<AiMessage[]> {
    const messages = await this.prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { seq: 'desc' },
      take: TRANSCRIPT_LIMIT,
    });
    return messages.reverse();
  }

  private emitConversationChanged(
    tenantId: string,
    userId: string,
    conversationId: string | null,
    reason: AiConversationChanged['reason'],
  ): void {
    // Сигнал без даних: реакція клієнта — одне дедупліковане перечитування стрічки.
    // Долітає в УСІ вкладки юзера, включно з тією, що ініціювала дію (design.md D7)
    this.realtime.toUsers(tenantId, [userId], REALTIME_EVENTS.aiConversationChanged, {
      conversationId,
      reason,
      occurredAt: new Date().toISOString(),
    });
  }
}
