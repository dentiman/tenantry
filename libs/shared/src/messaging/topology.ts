import type { MessageDefinition } from './message-definition';
import {
  generateAiReplyCommand,
  purgeAiConversationsCommand,
  reconcileAiUsageCostsCommand,
  syncAiModelPricesCommand,
} from './definitions/ai.messages';
import {
  channelsDeliverOutboundCommand,
  channelsPurgeLogsCommand,
  channelsIngestWebhookCommand,
  channelsSweepPendingStatusesCommand,
  chatCustomerMessageReceivedEvent,
  chatMessagePostedEvent,
} from './definitions/chat.messages';
import {
  emailChangedEvent,
  emailChangeRequestedEvent,
  passwordResetRequestedEvent,
} from './definitions/auth.messages';
import { cleanupOrphanFilesCommand, generateThumbnailCommand } from './definitions/files.messages';
import {
  cleanupExpiredTokensCommand,
  cleanupProcessedJobsCommand,
} from './definitions/maintenance.messages';
import { dispatchScheduledNotificationsCommand } from './definitions/notifications.messages';
import { userRegisteredEvent } from './definitions/users.messages';

/**
 * Політика черги споживача.
 * - 'standard': паралельна обробка (більшість випадків).
 * - 'key_strict_fifo': рівно ОДИН активний job на singletonKey, решта чекають у
 *   FIFO-порядку. Ціна: перманентно впалий job блокує весь свій ключ до ручного розбору
 *   (boss.getBlockedKeys()). Брати тільки там, де порядок по агрегату важливіший за
 *   пропускну здатність (гроші/баланси) — і навіть там атомарний SQL лишається
 *   першим рубежем, а не політика черги.
 */
export type ConsumerQueuePolicy = 'standard' | 'key_strict_fifo';

export interface ConsumerSpec {
  /** Стабільний id споживача — частина імені черги, перейменування = нова черга */
  readonly id: string;
  readonly retryLimit?: number;
  readonly retryDelaySeconds?: number;
  readonly retryBackoff?: boolean;
  readonly policy?: ConsumerQueuePolicy;
  /**
   * Скільки воркерів цієї черги підняти В ЦЬОМУ процесі. Дефолт pg-boss — 1, тобто
   * ОДНА робота за раз на всю репліку: для листів і мініатюр це нормально, для
   * довгої роботи (виклик LLM на десятки секунд) це означає, що другий користувач
   * чекає, поки догенерується перший.
   *
   * Це per-node: три репліки з `localConcurrency: 4` дають 12 воркерів сумарно.
   */
  readonly localConcurrency?: number;
  /**
   * Скільки робіт ОДНІЄЇ групи можуть виконуватись одночасно в усьому кластері
   * (pg-boss рахує це в БД). Група задається на публікації — `publish(..., { group })`.
   *
   * Наш єдиний сценарій — справедливість між тенантами: групою є `tenantId`, і один
   * тенант фізично не може зайняти всі воркери. Обмеження оптимістичне: під гонкою
   * кількох fetch-ів ліміт може бути коротко перевищений, тому це межа СПРАВЕДЛИВОСТІ,
   * а не коректності (коректність — унікальний стан рядка в домені).
   */
  readonly groupConcurrency?: number;
  /**
   * Інтервал опитування черги. Дефолт pg-boss — 2 с, тобто до 2 с затримки до
   * початку роботи. Знижується там, де ця затримка видима людині.
   *
   * Мінімум у pg-boss — 0.5 с. Альтернатива (`useListenNotify`) дала б мілісекунди,
   * але вмикає LISTEN на весь інстанс — `docs/realtime.md` уже один раз відхилив
   * `LISTEN/NOTIFY` як глобальний ресурс кластера.
   */
  readonly pollingIntervalSeconds?: number;
  /**
   * Скільки робота може бути в стані `active`, перш ніж її заберуть назад. Дефолт
   * pg-boss — 15 хвилин, що для завислого зовнішнього виклику надто довго.
   *
   * На відміну від решти полів цієї групи, це властивість ЧЕРГИ (а не воркера), тому
   * вона ще й синхронізується в `PgBossService.syncQueues()`.
   */
  readonly expireInSeconds?: number;
}

export interface TopologyEntry {
  readonly definition: MessageDefinition;
  readonly consumers: readonly ConsumerSpec[];
  /** Розклад: pg-boss сам публікує це повідомлення (продюсера в коді немає) */
  readonly cron?: string;
}

/**
 * MESSAGE_TOPOLOGY — ЄДИНЕ місце, де видно всю асинхронну топологію системи:
 * події з їхніми підписниками, команди, cron. Продюсер (apps/api) і споживачі
 * (apps/worker) — різні процеси, тому список споживачів мусить бути відомий на боці
 * продюсера в МОМЕНТ публікації; runtime-discovery тут неможливий за побудовою.
 *
 * Додати підписника = рядок тут + новий клас. Жоден наявний файл не редагується.
 *
 * Розсинхрон між цим списком і класами @MessageSubscriber — це КРАШ при старті воркера
 * (MessageWorkerRegistrar), а не тихо недоставлені повідомлення.
 */
export const MESSAGE_TOPOLOGY: readonly TopologyEntry[] = [
  {
    // CHAT-2a: розбір збереженого вебхука каналу. Свідомо `standard`, а не `key_strict_fifo`:
    // порядок записує `seq` розмови, провайдер порядку не гарантує, а постійно впала робота
    // блокувала б ключ (docs/whatsapp-channel.md §4.5). Коректність тримають унікальні індекси
    // (дедуп за external_id, одна відкрита розмова на контакт), а не черга.
    definition: channelsIngestWebhookCommand,
    consumers: [{ id: 'channels-ingest', retryLimit: 3, retryDelaySeconds: 2, retryBackoff: true, pollingIntervalSeconds: 0.5 }],
  },
  {
    // CHAT-2b: відправка вихідного. СУВОРИЙ порядок по розмові (O-W3): клієнт має бачити репліки в
    // порядку написання. Ціна політики — впала назавжди робота блокує свій ключ, тому обробник
    // (ChannelDeliveryService) НЕ завершується помилкою ні на чому, крім повтору, що має шанс
    // вдатися: решта стає FAILED у рядку. Лічильник спроб — у рядку (чергу обробник не бачить),
    // тож retryLimit більший за межу обробника (5): pg-boss не вичерпає повторів раніше за нього.
    definition: channelsDeliverOutboundCommand,
    consumers: [
      {
        id: 'channels-deliver',
        policy: 'key_strict_fifo',
        retryLimit: 6,
        retryDelaySeconds: 2,
        retryBackoff: true,
        pollingIntervalSeconds: 0.5,
        localConcurrency: 4,
      },
    ],
  },
  {
    // CHAT-3a: журнал викликів до провайдера. 04:30 — після нічних чисток 03:xx і цін AI (04:15)
    definition: channelsPurgeLogsCommand,
    consumers: [{ id: 'channels-purge-logs', retryLimit: 1 }],
    cron: '30 4 * * *',
  },
  {
    // CHAT-2b: квитанції, що випередили запис external_id. Раз на хвилину; після 5 спроб — відкидаємо з логом
    definition: channelsSweepPendingStatusesCommand,
    consumers: [{ id: 'channels-sweep-pending', retryLimit: 1 }],
    cron: '* * * * *',
  },
  {
    // CHAT-2b: сповіщення призначеному агентові про вхідне від клієнта
    definition: chatCustomerMessageReceivedEvent,
    consumers: [{ id: 'chat-notify-customer', pollingIntervalSeconds: 0.5 }],
  },
  {
    // CHAT-0.2c: сповіщення учасникам внутрішньої розмови. 0.5 с, як у ai-generator: затримку
    // бачить людина (дзвінок у шапці), а живу репліку відкриті вкладки вже отримали сокетом.
    definition: chatMessagePostedEvent,
    consumers: [{ id: 'chat-notify', pollingIntervalSeconds: 0.5 }],
  },
  {
    definition: userRegisteredEvent,
    consumers: [{ id: 'welcome-email' }],
  },
  {
    definition: passwordResetRequestedEvent,
    consumers: [{ id: 'password-reset-email' }],
  },
  {
    definition: emailChangeRequestedEvent,
    consumers: [{ id: 'email-change-email' }],
  },
  {
    definition: emailChangedEvent,
    consumers: [{ id: 'email-changed-notice' }],
  },
  {
    definition: generateThumbnailCommand,
    consumers: [{ id: 'thumbnailer' }],
  },
  {
    definition: cleanupOrphanFilesCommand,
    consumers: [{ id: 'orphan-cleaner', retryLimit: 1 }],
    cron: '30 3 * * *',
  },
  {
    definition: cleanupExpiredTokensCommand,
    consumers: [{ id: 'token-cleaner', retryLimit: 1 }],
    cron: '0 3 * * *',
  },
  {
    definition: cleanupProcessedJobsCommand,
    consumers: [{ id: 'inbox-cleaner', retryLimit: 1 }],
    cron: '15 3 * * *',
  },
  {
    // ai-1e, docs/ai-assistant.md §9.2: жорстке видалення розмов/повідомлень старших за
    // AI_RETENTION_DAYS. `:45` — одразу за трійкою нічних чисток вище (:00/:15/:30)
    definition: purgeAiConversationsCommand,
    consumers: [{ id: 'ai-conversation-purger', retryLimit: 1 }],
    cron: '45 3 * * *',
  },
  {
    // AI-5b, design.md R5: фактична вартість спроб без usage-кадру (Stop, таймаут, обрив,
    // падіння воркера). Кожні 5 хв, власний backoff рядка — у самій таблиці журналу
    definition: reconcileAiUsageCostsCommand,
    consumers: [{ id: 'ai-usage-cost-reconciler', retryLimit: 1 }],
    cron: '*/5 * * * *',
  },
  {
    // AI-5b, design.md R7: тарифи з публічних списків OpenRouter раз на добу, у вільний
    // нічний слот після чисток 03:xx
    definition: syncAiModelPricesCommand,
    consumers: [{ id: 'ai-model-price-syncer', retryLimit: 1 }],
    cron: '15 4 * * *',
  },
  {
    // Перший споживач, якому дефолти pg-boss не підходять (docs/ai-assistant-plan.md §3.4).
    //
    // localConcurrency 4: дефолт 1 означав би ОДНУ генерацію на всю інсталяцію —
    //   другий користувач чекав би, поки догенерується перший.
    // groupConcurrency 2: група на публікації — tenantId, тож один тенант фізично
    //   не може зайняти всі воркери. Межа справедливості, не коректності.
    // pollingIntervalSeconds 0.5: дефолтні 2 с — це до 2 с тиші перед першим
    //   токеном, і людина це бачить. `useListenNotify` дав би мілісекунди, але
    //   вмикає LISTEN на весь інстанс, а docs/realtime.md уже раз відхилив
    //   LISTEN/NOTIFY як глобальний ресурс кластера.
    // expireInSeconds 120: дефолтні 15 хв для завислого зовнішнього виклику задовгі.
    // Має перевищувати lease + ретраї (AiConfig.leaseMs + retryDelayMs × providerRetries,
    // AI-0.1 design.md D1) — інакше pg-boss редоставив би job, чий власник ще живий:
    // безпечно (захоплення просто не вдасться), але марно спалює цей ретрай на
    // ситуацію, яку він не для того тримає. Перевіряється при старті воркера
    // (ai-lease.guard.ts) — конфіг, що порушує це, не піднімається.
    //
    // retryLimit 1: ЦЕ ПОКРИВАЄ ЛИШЕ ПАДІННЯ ПРОЦЕСУ (AI-0.1, review п.3), а НЕ
    //   тимчасову відмову провайдера — та ретраїться ВСЕРЕДИНІ доставки
    //   (design.md D2, AiConfig.providerRetries), бо тільки так відомо, чи лишився
    //   бюджет: обробник не бачить `retryCount` черги. Редоставлений після падіння
    //   job захоплює покинутий рядок наново, бо його оренда вже минула.
    definition: generateAiReplyCommand,
    consumers: [
      {
        id: 'ai-generator',
        retryLimit: 1,
        retryDelaySeconds: 2,
        localConcurrency: 4,
        groupConcurrency: 2,
        pollingIntervalSeconds: 0.5,
        expireInSeconds: 120,
      },
    ],
  },
  {
    // Єдиний рядок, який календар додає в топологію (docs/calendar.md §9.4):
    // подій `calendar.*` тут поки немає свідомо — маніфест валить старт воркера
    // на оголошену подію без класу-споживача, тому вони зʼявляться разом зі
    // своїм першим підписником (розсилка інвайтів / зовнішня синхра, CAL-3+).
    //
    // retryLimit 1: пропущений тік нічого не втрачає — наступний за хвилину
    // побачить ті самі дозрілі рядки (джерело правди — таблиця, не job)
    definition: dispatchScheduledNotificationsCommand,
    consumers: [{ id: 'scheduled-dispatcher', retryLimit: 1 }],
    cron: '* * * * *',
  },
];

/**
 * Черга на споживача: `${message}/${consumer}` (§3.0 — різне ім'я = різна черга).
 *
 * Роздільник `/`, а НЕ `#`: pg-boss валідує імена черг і приймає лише
 * алфавітно-цифрові символи, `_`, `-`, `.` та `/` (assertQueueName). Спіймано
 * живим стартом воркера — мок pg-boss у e2e цієї перевірки не має.
 */
export function queueNameFor(messageName: string, consumerId: string): string {
  return `${messageName}/${consumerId}`;
}

/** Спільна DLQ на всю систему: один екран розбору замість однієї черги на кожну чергу */
export const DEAD_LETTER_QUEUE = 'dlq';

const BY_NAME = new Map<string, TopologyEntry>();
for (const entry of MESSAGE_TOPOLOGY) {
  if (BY_NAME.has(entry.definition.name)) {
    throw new Error(`Duplicate message in MESSAGE_TOPOLOGY: ${entry.definition.name}`);
  }
  if (entry.consumers.length === 0) {
    throw new Error(`Message ${entry.definition.name} has no consumers in MESSAGE_TOPOLOGY`);
  }
  const ids = new Set(entry.consumers.map((c) => c.id));
  if (ids.size !== entry.consumers.length) {
    throw new Error(`Duplicate consumer id for message ${entry.definition.name}`);
  }
  // Ім'я черги мусить пройти pg-boss assertQueueName; ловимо це тут, щоб помилка
  // вказувала на рядок маніфесту, а не спливала асертом усередині pg-boss на старті
  for (const consumer of entry.consumers) {
    const queue = queueNameFor(entry.definition.name, consumer.id);
    if (!/^[a-zA-Z0-9_\-./]+$/.test(queue)) {
      throw new Error(
        `Queue name "${queue}" is invalid — pg-boss allows only alphanumerics, _ - . and /`,
      );
    }
  }
  // Команда за визначенням має рівно одного споживача — інакше це подія
  if (entry.definition.kind === 'command' && entry.consumers.length > 1) {
    throw new Error(
      `Command ${entry.definition.name} has ${String(entry.consumers.length)} consumers — ` +
        'commands take exactly one; declare it with defineEvent instead',
    );
  }
  // Cron-тік ідентифікується job.id-ом свого запуску, тому кілька споживачів дали б
  // кілька НЕЗАЛЕЖНИХ messageId — це вже не одна подія, а N різних. Якщо колись
  // знадобиться розклад із fan-out-ом, він має публікувати подію, а не тікати в черги.
  if (entry.cron && entry.consumers.length > 1) {
    throw new Error(`Scheduled message ${entry.definition.name} must have exactly one consumer`);
  }
  BY_NAME.set(entry.definition.name, entry);
}

export function topologyFor(messageName: string): TopologyEntry {
  const entry = BY_NAME.get(messageName);
  if (!entry) {
    throw new Error(
      `Message ${messageName} is not declared in MESSAGE_TOPOLOGY — ` +
        'add it there before publishing',
    );
  }
  return entry;
}

/** Усі черги системи (включно з DLQ) — для створення при старті */
export function allQueueNames(): string[] {
  const names = MESSAGE_TOPOLOGY.flatMap((entry) =>
    entry.consumers.map((consumer) => queueNameFor(entry.definition.name, consumer.id)),
  );
  return [DEAD_LETTER_QUEUE, ...names];
}
