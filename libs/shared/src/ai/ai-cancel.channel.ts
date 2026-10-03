import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REALTIME_DEFAULT_KEY_PREFIX } from '@saas-skeleton/contracts';

const DEFAULT_REDIS_URL = 'redis://:saas-realtime@localhost:6379';

/**
 * Канал «зупинити генерацію»: `apps/api` публікує, `apps/worker` слухає.
 *
 * Чому pub/sub, а не прапорець у БД: воркер у цей момент сидить усередині читання
 * потоку від провайдера і базу не опитує. Опитування довелося б вплітати між
 * кадрами — зайвий запит на кожні 120 мс кожної активної генерації заради події,
 * яка стається рідко.
 *
 * Доставка тут at-most-once, і це нормально: не доїхало скасування — генерація
 * просто дійде до кінця або впреться в `AI_REQUEST_TIMEOUT_MS`. Джерелом правди
 * лишається статус рядка `ai_messages`, а не факт отримання повідомлення.
 *
 * ДВА зʼєднання, бо ioredis у режимі підписки не приймає інших команд: `publisher`
 * живе в api, `subscriber` — у воркері, і кожен процес створює лише те, що йому
 * справді потрібно (ліниво, на першому виклику).
 */
@Injectable()
export class AiCancelChannel implements OnApplicationShutdown {
  private readonly logger = new Logger(AiCancelChannel.name);
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private readonly listeners = new Map<string, Set<() => void>>();

  /** Запросити скасування. Не кидає: невдале скасування не має валити HTTP-запит */
  async requestCancel(messageId: string): Promise<void> {
    try {
      await this.ensurePublisher().publish(channelFor(messageId), '1');
    } catch (error) {
      this.logger.warn(`Cancel request for ${messageId} was not delivered: ${errorMessage(error)}`);
    }
  }

  /**
   * Підписатись на скасування конкретної відповіді. Повертає відписку, яку
   * ОБОВʼЯЗКОВО викликати у `finally` генерації — інакше підписки накопичаться
   * на кожну оброблену відповідь.
   */
  async onCancel(messageId: string, handler: () => void): Promise<() => void> {
    const channel = channelFor(messageId);
    const existing = this.listeners.get(channel);
    if (existing) {
      existing.add(handler);
    } else {
      this.listeners.set(channel, new Set([handler]));
      try {
        await this.ensureSubscriber().subscribe(channel);
      } catch (error) {
        this.logger.warn(`Cannot subscribe to ${channel}: ${errorMessage(error)}`);
      }
    }

    return () => {
      const handlers = this.listeners.get(channel);
      if (!handlers) {
        return;
      }
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(channel);
        void this.subscriber?.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  private ensurePublisher(): Redis {
    this.publisher ??= this.createClient('publisher');
    return this.publisher;
  }

  private ensureSubscriber(): Redis {
    if (!this.subscriber) {
      const client = this.createClient('subscriber');
      client.on('message', (channel: string) => {
        for (const handler of this.listeners.get(channel) ?? []) {
          handler();
        }
      });
      this.subscriber = client;
    }
    return this.subscriber;
  }

  private createClient(role: string): Redis {
    const client = new Redis(process.env.REDIS_URL ?? DEFAULT_REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times): number => Math.min(times * 200, 5_000),
    });
    // Без обробника ioredis кидає unhandled 'error' і валить процес — недоступний
    // брокер не має права зупиняти ні HTTP, ні обробку черг
    client.on('error', (error: Error) => {
      this.logger.warn(`AI cancel ${role} connection error: ${error.message}`);
    });
    return client;
  }

  async onApplicationShutdown(): Promise<void> {
    for (const client of [this.publisher, this.subscriber]) {
      try {
        await client?.quit();
      } catch {
        client?.disconnect();
      }
    }
  }
}

function channelFor(messageId: string): string {
  const prefix = process.env.REALTIME_KEY_PREFIX ?? REALTIME_DEFAULT_KEY_PREFIX;
  return `${prefix}:ai:cancel:${messageId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
