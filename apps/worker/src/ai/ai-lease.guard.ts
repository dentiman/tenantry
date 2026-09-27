import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { AI_CONFIG, MESSAGE_TOPOLOGY, type AiConfig } from '@saas-skeleton/shared';

const AI_GENERATOR_CONSUMER_ID = 'ai-generator';
const AI_GENERATE_REPLY_MESSAGE = 'ai.generate-reply';

/**
 * Перевірка при старті воркера (AI-0.1, design.md D1): `expireInSeconds` споживача
 * `ai-generator` МАЄ перевищувати `leaseMs + retryDelayMs × providerRetries`.
 *
 * Якщо ні — pg-boss редоставить job, чий власник ще живий, ЩЕ ДО того, як минула
 * оренда генерації. Захоплення такого делівері просто не вдасться (design.md D1
 * не постраждає), але це марно спалить ретрай черги, який `libs/shared/src/
 * messaging/topology.ts` тримає для відновлення після падіння процесу, а не для
 * цього. Валиться той самий спосіб, що й розбіжність між маніфестом і класами
 * підписників у `MessageWorkerRegistrar` — конфіг, що порушує це, не піднімається.
 */
@Injectable()
export class AiLeaseGuard implements OnApplicationBootstrap {
  constructor(@Inject(AI_CONFIG) private readonly config: AiConfig) {}

  onApplicationBootstrap(): void {
    const entry = MESSAGE_TOPOLOGY.find(
      (candidate) => candidate.definition.name === AI_GENERATE_REPLY_MESSAGE,
    );
    const consumer = entry?.consumers.find((c) => c.id === AI_GENERATOR_CONSUMER_ID);
    if (!consumer) {
      throw new Error(
        `AiLeaseGuard: no '${AI_GENERATOR_CONSUMER_ID}' consumer found in MESSAGE_TOPOLOGY for '${AI_GENERATE_REPLY_MESSAGE}'`,
      );
    }

    const expireInMs = (consumer.expireInSeconds ?? 0) * 1_000;
    const requiredMs =
      this.config.leaseMs + this.config.retryDelayMs * this.config.providerRetries;

    if (expireInMs <= requiredMs) {
      throw new Error(
        `AiLeaseGuard: ai-generator's expireInSeconds (${String(expireInMs)}ms) must exceed ` +
          `leaseMs + retryDelayMs × providerRetries (${String(requiredMs)}ms) — otherwise ` +
          'pg-boss would redeliver a job whose generation lease is still live (design.md D1)',
      );
    }
  }
}
