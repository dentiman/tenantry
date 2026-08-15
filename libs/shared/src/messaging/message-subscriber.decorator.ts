import { DiscoveryService } from '@nestjs/core';
import { z } from 'zod';
import type { MessageDefinition } from './message-definition';
import type { MessageEnvelope } from './message-envelope';

export interface SubscriberMetadata {
  readonly definition: MessageDefinition;
  /** Мусить збігатися з id у MESSAGE_TOPOLOGY — розсинхрон валить старт воркера */
  readonly id: string;
}

/**
 * Контракт споживача. `data` уже провалідовано схемою повідомлення, `envelope` дає
 * доступ до messageId (ключ ідемпотентності), актора і ланцюга.
 */
export interface MessageSubscriberContract<TSchema extends z.ZodType = z.ZodType> {
  handle(data: z.output<TSchema>, envelope: MessageEnvelope): Promise<void>;
}

/**
 * Позначає @Injectable()-клас споживачем повідомлення. Воркер знаходить такі класи
 * через DiscoveryService і звіряє набір із MESSAGE_TOPOLOGY при старті.
 *
 * Приклад: `@MessageSubscriber({ definition: userRegisteredEvent, id: 'welcome-email' })`
 */
export const MessageSubscriber = DiscoveryService.createDecorator<SubscriberMetadata>();
