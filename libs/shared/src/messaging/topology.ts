import type { MessageDefinition } from './message-definition';
import {
  cleanupOrphanFilesCommand,
  generateThumbnailCommand,
} from './definitions/files.messages';
import {
  cleanupExpiredTokensCommand,
  cleanupProcessedJobsCommand,
} from './definitions/maintenance.messages';
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
    definition: userRegisteredEvent,
    consumers: [{ id: 'welcome-email' }],
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
    throw new Error(
      `Scheduled message ${entry.definition.name} must have exactly one consumer`,
    );
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
