import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { MessageActor, MessageEnvelope } from './message-envelope';

const CORRELATION_ID_KEY = 'messageCorrelationId';
const CAUSATION_ID_KEY = 'messageCausationId';
const ACTOR_KEY = 'messageActor';

/**
 * Контекст ланцюга повідомлень (CLS). Дзеркалить TenantContextService, але для
 * causality: correlationId тримає весь ланцюг, causationId — безпосереднього батька,
 * actor — людину, що ініціювала операцію.
 *
 * Заповнюється у двох місцях: HTTP-мідлварі (correlationId = pino req.id, той самий,
 * що юзер бачить у ApiError.requestId) і в MessageWorkerRegistrar із конверта. Завдяки
 * цьому похідна публікація всередині підписника успадковує ланцюг АВТОМАТИЧНО —
 * доменний код про correlationId не знає й не згадує.
 */
@Injectable()
export class MessageContextService {
  constructor(private readonly cls: ClsService) {}

  getCorrelationId(): string | undefined {
    return this.cls.isActive() ? this.cls.get<string | undefined>(CORRELATION_ID_KEY) : undefined;
  }

  getCausationId(): string | undefined {
    return this.cls.isActive() ? this.cls.get<string | undefined>(CAUSATION_ID_KEY) : undefined;
  }

  getActor(): MessageActor | undefined {
    return this.cls.isActive() ? this.cls.get<MessageActor | undefined>(ACTOR_KEY) : undefined;
  }

  /** HTTP-вхід: корінь ланцюга (causation ще немає) */
  setCorrelationId(correlationId: string): void {
    if (this.cls.isActive()) {
      this.cls.set(CORRELATION_ID_KEY, correlationId);
    }
  }

  setActor(actor: MessageActor): void {
    if (this.cls.isActive()) {
      this.cls.set(ACTOR_KEY, actor);
    }
  }

  /** Worker: підняти контекст із конверта — похідні публікації успадкують ланцюг */
  applyEnvelope(envelope: MessageEnvelope): void {
    this.cls.set(CORRELATION_ID_KEY, envelope.correlationId);
    this.cls.set(CAUSATION_ID_KEY, envelope.messageId);
    this.cls.set(ACTOR_KEY, envelope.actor);
  }
}
