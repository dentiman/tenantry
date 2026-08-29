import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import { REALTIME_CONFIG } from '../realtime.constants';
import type { RealtimeConfig } from '../realtime.config';

/** tenantId → userId → найпізніша позначка (epoch ms), ще не злита в БД */
type PendingMarks = Map<string, Map<string, number>>;

/**
 * Довговічний `users.last_seen_at` (RT-3).
 *
 * Семантика поля — **high-water mark**: найпізніший момент, коли система ТОЧНО
 * знала про живе зʼєднання юзера. Свідомо НЕ «момент дисконекту»: половина
 * розривів у нас дисконекту не має взагалі (`transport close`, `kill -9` ноди,
 * недоступна Valkey), і поле, привʼязане до однієї події, у цих режимах просто
 * не оновилося б. Тому позначки надходять із шести точок життєвого циклу
 * (див. `PresenceService`), а коректність тримає монотонність запису.
 *
 * Write-behind, а не запис на місці: rolling deploy — це сотні одночасних
 * реконектів, тобто сотні окремих UPDATE-ів у найгіршу хвилину. Буфер коалесує
 * їх у один batched стейтмент на тенант.
 */
@Injectable()
export class LastSeenWriter implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LastSeenWriter.name);
  private readonly pending: PendingMarks = new Map();
  private flushTimer: NodeJS.Timeout | null = null;
  private degraded = false;

  constructor(
    private readonly transactions: TenantTransactions,
    private readonly tenantContext: TenantContextService,
    @Inject(REALTIME_CONFIG) private readonly config: RealtimeConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.config.lastSeenFlushMs);
    this.flushTimer.unref();
  }

  /**
   * Страховка на випадок, якщо Nest викличе хук цього провайдера раніше за
   * `PresenceService` (порядок між провайдерами не гарантований): злити те, що
   * встигло накопичитись. Повторний виклик після drain-у безпечний — буфер порожній.
   */
  async onApplicationShutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /**
   * Синхронний і такий, що НЕ кидає: викликається з гарячих шляхів presence
   * (handshake, disconnect), і збій довговічного запису не має права ні
   * сповільнити їх, ні розірвати зʼєднання.
   */
  mark(tenantId: string, userId: string, atMs: number = Date.now()): void {
    let users = this.pending.get(tenantId);
    if (!users) {
      users = new Map();
      this.pending.set(tenantId, users);
    }
    const known = users.get(userId);
    // max, а не перезапис: у буфер сиплються джерела з різним часом (sweep пише
    // момент останнього heartbeat-а, тобто МИНУЛЕ) — назад значення не рухаємо
    if (known === undefined || known < atMs) {
      users.set(userId, atMs);
    }
  }

  markMany(tenantId: string, userIds: readonly string[], atMs: number = Date.now()): void {
    for (const userId of userIds) {
      this.mark(tenantId, userId, atMs);
    }
  }

  /** Негайний злив (shutdown, тести). Помилку ковтає так само, як періодичний */
  async flushNow(): Promise<void> {
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.pending.size === 0) {
      return;
    }
    // Забираємо буфер ДО await-ів: позначки, що прийдуть під час запису,
    // потраплять у наступний цикл, а не загубляться і не подвояться
    const batches = [...this.pending.entries()];
    this.pending.clear();

    for (const [tenantId, users] of batches) {
      try {
        await this.write(tenantId, [...users.keys()], [...users.values()]);
        this.markHealthy();
      } catch (error) {
        this.markDegraded(error);
        // Повертаємо позначки в буфер: наступна спроба їх допише. Монотонність
        // робить повтор безпечним — свіжіше значення старішим не перезапишеться
        for (const [userId, atMs] of users) {
          this.mark(tenantId, userId, atMs);
        }
      }
    }
  }

  /**
   * Сирий UPDATE — другий легальний випадок raw SQL у проєкті (перший — колапс
   * сповіщень). Prisma тут не підходить із двох незалежних причин:
   *
   *  1. будь-який `prisma.user.update*` підняв би `@updatedAt`, і кожні пʼять
   *     хвилин присутності виглядали б як редагування профілю — «Last updated»
   *     на картці юзера показував би час, що не стосується жодної зміни даних;
   *  2. умову «пиши, лише якщо новіше» треба виконати В ОДНОМУ стейтменті:
   *     read-modify-write із двох нод дав би відкат значення назад.
   *
   * `WHERE last_seen_at < …` — не дублювання, а економія: без нього кожен цикл
   * переписував би рядок тим самим значенням (dead tuple + WAL на порожньому місці).
   *
   * Час іде epoch-мілісекундами і перетворюється в БД: node-postgres серіалізує
   * `Date` з ЛОКАЛЬНИМ зсувом, а колонка — `timestamp` без зони, у якій Prisma
   * зберігає UTC. `to_timestamp(...) AT TIME ZONE 'UTC'` знімає це питання
   * незалежно від таймзони процесу і сесії. `::text[]`, а не `::uuid[]`: Prisma
   * тримає id як `String`, тобто колонка — `text`, і порівняння з uuid упало б.
   */
  private async write(tenantId: string, userIds: string[], atMs: number[]): Promise<void> {
    // `$executeRaw` ОБХОДИТЬ tenant-extension, тобто без явного контексту
    // set_config не виконається і RLS оновить нуль рядків — мовчки, без помилки.
    // Тому запис іде в `withTenantTx`, а tenantId передається явно: presence
    // живе поза HTTP-запитом, CLS для нього ніхто не піднімає.
    await this.tenantContext.runWith(tenantId, () =>
      this.transactions.withTenantTx(
        (tx) => tx.$executeRaw`
          UPDATE users AS u
             SET last_seen_at = to_timestamp(t.seen_ms / 1000.0) AT TIME ZONE 'UTC'
            FROM unnest(${userIds}::text[], ${atMs}::double precision[]) AS t(id, seen_ms)
           WHERE u.id = t.id
             AND (
               u.last_seen_at IS NULL
               OR u.last_seen_at < to_timestamp(t.seen_ms / 1000.0) AT TIME ZONE 'UTC'
             )
        `,
      ),
    );
  }

  private markDegraded(error: unknown): void {
    if (!this.degraded) {
      this.degraded = true;
      this.logger.error(`Failed to persist last-seen marks: ${String(error)}`);
    }
  }

  private markHealthy(): void {
    if (this.degraded) {
      this.degraded = false;
      this.logger.log('Last-seen writer recovered');
    }
  }
}
