import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, TenantContextService, TenantTransactions } from '@saas-skeleton/database';
import type { Prisma } from '@saas-skeleton/database';
import {
  NUMBER_SERIES_DEFAULTS,
  NUMBER_SERIES_NAMES,
  type NumberResetPeriod,
  type NumberSeriesName,
  type NumberSeriesResponse,
  type UpdateNumberSeries,
} from '@saas-skeleton/contracts';

/** Конфіг серії після накладання рядка тенанта на дефолт із контрактів */
export interface ResolvedNumberSeries {
  name: NumberSeriesName;
  prefix: string;
  padding: number;
  startValue: number;
  resetPeriod: NumberResetPeriod;
  resettable: boolean;
  /** false — рядка в БД немає, діють дефолти з коду */
  isCustomized: boolean;
}

/**
 * Нумераційний двигун (docs/customers.md §5): видає людські номери сутностей —
 * ЦІЛІ, свої в кожного тенанта, безрозривні.
 *
 * Живе в `libs/shared`, а не в модулі кастомерів, бо наступний споживач —
 * документи (рахунки), і саме там ціна помилки в нумерації максимальна. Різниця
 * між ними лише в конфігу серії, а не в механіці.
 *
 * **Чому таблиця-лічильник, а не `CREATE SEQUENCE`:** послідовність одна на всю
 * БД (номери скакали б між тенантами і витікав би обсяг сусіда), вона поза RLS,
 * і головне — `nextval` НЕ відкочується разом із транзакцією, тобто лишає дірки.
 * Тут інкремент живе в тій самій транзакції, що й сам рядок: відкат забирає і
 * номер. Ціна — блокування рядка лічильника до коміту, тобто серіалізація
 * створення в межах (тенант, серія, період).
 *
 * **Чому не `MAX(number) + 1` під advisory-локом** (він теж безрозривний і не
 * потребує лічильника): після видалення найстаршого запису номер
 * ПЕРЕВИКОРИСТОВУЄТЬСЯ. Для кастомера це прикро, для рахунка — недопустимо.
 */
@Injectable()
export class NumberingService {
  private readonly logger = new Logger(NumberingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantTx: TenantTransactions,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Видати наступний номер. Викликається В ТІЙ САМІЙ транзакції, що й INSERT
   * рядка, якому номер потрібен, — і **якомога пізніше**: блокування лічильника
   * тримається до коміту, тож усе, що можна зробити до нього, має бути зроблене.
   * Зовнішнього I/O (SMTP, платіжний провайдер) у такій транзакції бути не може.
   *
   * `at` — ділова дата документа, а НЕ `now()`: рахунок, виставлений 31 грудня і
   * збережений 1 січня, мусить потрапити у свій рік.
   */
  async allocate(
    tx: Prisma.TransactionClient,
    name: NumberSeriesName,
    at: Date = new Date(),
  ): Promise<number> {
    const series = await this.resolveWithin(tx, name);
    const scope = this.scopeFor(series.resetPeriod, at);

    // Один атомарний стейтмент. tenant_id не згадується ніде: у INSERT його
    // ставить DB-default із CLS, а підзапит до number_series скоупить RLS —
    // мультитенантність лишається невидимою і тут.
    //
    // Гілка INSERT спрацьовує рівно раз на (серія, період) і кладе startValue:
    // саме так «початковий номер» стає ПЕРШИМ виданим, а не первим+1.
    const rows = await tx.$queryRaw<{ last_value: number }[]>`
      INSERT INTO number_sequences (name, scope, last_value)
      VALUES (${name}, ${scope}, ${series.startValue})
      ON CONFLICT (tenant_id, name, scope)
        DO UPDATE SET last_value = number_sequences.last_value + 1
      RETURNING last_value
    `;

    const row = rows[0];
    if (!row) {
      // Недосяжно: ON CONFLICT DO UPDATE завжди повертає рядок. Явна перевірка
      // замість `!` — щоб мовчазний undefined не став номером NaN
      throw new Error(`number_sequences upsert returned no row for series "${name}"`);
    }
    return row.last_value;
  }

  /** `prefix + нулі + номер`. Presentation, а не ідентичність */
  format(series: ResolvedNumberSeries, value: number): string {
    return `${series.prefix}${String(value).padStart(series.padding, '0')}`;
  }

  /** Конфіг серії для маперів і екрана налаштувань (одне читання на запит) */
  async resolve(name: NumberSeriesName): Promise<ResolvedNumberSeries> {
    const row = await this.prisma.numberSeries.findFirst({ where: { name } });
    return this.merge(name, row);
  }

  async list(): Promise<NumberSeriesResponse[]> {
    return Promise.all(NUMBER_SERIES_NAMES.map((name) => this.describe(name)));
  }

  /** Стан серії для екрана налаштувань: конфіг + номер, який піде наступним */
  async describe(name: NumberSeriesName): Promise<NumberSeriesResponse> {
    const series = await this.resolve(name);
    const scope = this.scopeFor(series.resetPeriod, new Date());
    const counter = await this.prisma.numberSequence.findFirst({ where: { name, scope } });
    // Лічильника ще немає → наступним піде startValue; є → last_value + 1
    const nextNumber = counter ? counter.lastValue + 1 : series.startValue;

    return {
      name: series.name,
      prefix: series.prefix,
      padding: series.padding,
      startValue: series.startValue,
      resetPeriod: series.resetPeriod,
      resettable: series.resettable,
      nextNumber,
      nextLabel: this.format(series, nextNumber),
      isCustomized: series.isCustomized,
    };
  }

  /**
   * Зміна формату і початкового номера. `startValue` діє на МАЙБУТНІ періоди —
   * вже початий лічильник він не рухає: діапазон, який уже роздали клієнтам,
   * заднім числом не переписують. Для нього є setNextNumber().
   */
  async update(name: NumberSeriesName, patch: UpdateNumberSeries): Promise<void> {
    await this.tenantTx.withTenantTx(async (tx) => {
      const current = await this.resolveWithin(tx, name);
      await tx.numberSeries.upsert({
        // Явний tenantId: PK композитний, інакше `where` не скласти. Легально —
        // це інфраструктурний сервіс, а не домен (той самий виняток, що в
        // NotificationStateService)
        where: { tenantId_name: { tenantId: this.tenantContext.requireTenantId(), name } },
        create: {
          name,
          prefix: patch.prefix ?? current.prefix,
          padding: patch.padding ?? current.padding,
          startValue: patch.startValue ?? current.startValue,
          resetPeriod: current.resetPeriod,
        },
        update: {
          ...(patch.prefix !== undefined && { prefix: patch.prefix }),
          ...(patch.padding !== undefined && { padding: patch.padding }),
          ...(patch.startValue !== undefined && { startValue: patch.startValue }),
        },
      });
    });
    this.logger.log(`Number series "${name}" updated`);
  }

  /**
   * «Наступний номер = N» — операція над ЛІЧИЛЬНИКОМ. Тільки вгору: попередні
   * номери вже видані, і зниження гарантує колізію на унікальному індексі
   * (`GREATEST` робить спробу знизити тихим no-op, а не помилкою — адмін просто
   * бачить у відповіді, що номер не змінився).
   *
   * Головний сценарій — імпорт старої бази: залили чужі номери напряму, потім
   * одноразово підняли лічильник до максимуму використаного.
   */
  async setNextNumber(name: NumberSeriesName, nextNumber: number): Promise<void> {
    await this.tenantTx.withTenantTx(async (tx) => {
      const series = await this.resolveWithin(tx, name);
      const scope = this.scopeFor(series.resetPeriod, new Date());

      await tx.$executeRaw`
        INSERT INTO number_sequences (name, scope, last_value)
        VALUES (${name}, ${scope}, ${nextNumber - 1})
        ON CONFLICT (tenant_id, name, scope)
          DO UPDATE SET last_value = GREATEST(number_sequences.last_value, ${nextNumber - 1})
      `;
    });
    this.logger.log(`Number series "${name}" counter moved to next=${String(nextNumber)}`);
  }

  /**
   * Бакет скидання. NONE — один наскрізний лічильник; YEARLY/MONTHLY — свій на
   * період, тобто «рахунок №1 за 2027 рік» законний. Дата рахується в UTC:
   * часових поясів тенанта в моделі поки немає, і краще один задокументований
   * пояс, ніж непередбачуваний серверний.
   */
  scopeFor(resetPeriod: NumberResetPeriod, at: Date): string {
    if (resetPeriod === 'NONE') return '';
    const year = at.getUTCFullYear();
    if (resetPeriod === 'YEARLY') return String(year);
    return `${String(year)}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private async resolveWithin(
    tx: Prisma.TransactionClient,
    name: NumberSeriesName,
  ): Promise<ResolvedNumberSeries> {
    const row = await tx.numberSeries.findFirst({ where: { name } });
    return this.merge(name, row);
  }

  /** Рядок тенанта поверх дефолтів із контрактів (як NOTIFICATION_TYPE_META) */
  private merge(
    name: NumberSeriesName,
    row: {
      prefix: string;
      padding: number;
      startValue: number;
      resetPeriod: NumberResetPeriod;
    } | null,
  ): ResolvedNumberSeries {
    const defaults = NUMBER_SERIES_DEFAULTS[name];
    return {
      name,
      prefix: row?.prefix ?? defaults.prefix,
      padding: row?.padding ?? defaults.padding,
      startValue: row?.startValue ?? defaults.startValue,
      // Період скидання приходить ТІЛЬКИ з коду: у майстер-даних він безглуздий,
      // і дати тенанту ввімкнути його — значить зламати унікальність номера
      resetPeriod: defaults.resetPeriod,
      resettable: defaults.resettable,
      isCustomized: row !== null,
    };
  }
}
