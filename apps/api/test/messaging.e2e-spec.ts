/// <reference types="jest" />

// EDA-1: захисна сітка навколо конвеєра повідомлень
// (docs/event-driven-architecture.md). Три властивості, кожна закриває конкретний
// розрив з §2 того документа.

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  SystemPrismaService,
  TenantContextService,
  TenantTransactions,
} from '@saas-skeleton/database';
import { DiscoveryService } from '@nestjs/core';
import {
  DEAD_LETTER_QUEUE,
  MESSAGE_TOPOLOGY,
  MessageContextService,
  MessageInboxService,
  MessageWorkerRegistrar,
  PgBossService,
  allQueueNames,
  queueNameFor,
  topologyFor,
  userRegisteredEvent,
  type MessageEnvelope,
} from '@saas-skeleton/shared';
import { DEFAULT_TENANT_ID } from './test-users';
import { randomUUID } from 'node:crypto';

describe('Messaging pipeline (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('MESSAGE_TOPOLOGY — маніфест', () => {
    it('кожне повідомлення має споживачів, а команда — рівно одного', () => {
      for (const entry of MESSAGE_TOPOLOGY) {
        expect(entry.consumers.length).toBeGreaterThan(0);
        if (entry.definition.kind === 'command') {
          expect(entry.consumers).toHaveLength(1);
        }
      }
    });

    it('cron оголошено лише на повідомленнях з одним споживачем', () => {
      // Інакше кожен тік дав би N незалежних messageId — це вже не одна подія
      for (const entry of MESSAGE_TOPOLOGY.filter((e) => e.cron)) {
        expect(entry.consumers).toHaveLength(1);
      }
    });

    it('імена подій версіоновані, імена команд — ні', () => {
      for (const entry of MESSAGE_TOPOLOGY) {
        if (entry.definition.kind === 'event') {
          expect(entry.definition.name).toMatch(/\.v\d+$/);
        }
      }
    });

    it('публікація неоголошеного повідомлення падає, а не йде в нікуди', () => {
      expect(() => topologyFor('billing.nothing-declared.v1')).toThrow(/MESSAGE_TOPOLOGY/);
    });

    it('allQueueNames містить спільну DLQ і черги на кожного споживача', () => {
      const queues = allQueueNames();
      expect(queues).toContain(DEAD_LETTER_QUEUE);
      expect(queues).toContain(queueNameFor(userRegisteredEvent.name, 'welcome-email'));
      // імена черг унікальні — інакше два споживачі мовчки ділили б одну чергу
      expect(new Set(queues).size).toBe(queues.length);
    });
  });

  describe('Boot-assert — розсинхрон маніфесту і класів валить старт', () => {
    /**
     * Найважливіша властивість конвеєра: помилка в топології мусить бути КРАШЕМ,
     * а не тихо недоставленими повідомленнями. Саме за відсутність цієї перевірки
     * забраковано рідний pub/sub pg-boss (§3.0.1) і NestJS-емітер.
     */
    const registrarWith = (
      subscribers: { definition: unknown; id: string }[],
    ): MessageWorkerRegistrar => {
      const wrappers = subscribers.map((meta) => ({ instance: { handle: async () => undefined }, meta }));
      const discovery = {
        getProviders: () => wrappers,
        getMetadataByDecorator: (_decorator: unknown, wrapper: { meta: unknown }) => wrapper.meta,
      } as unknown as DiscoveryService;

      return new MessageWorkerRegistrar(
        discovery,
        app.get(PgBossService),
        app.get(TenantContextService),
        app.get(MessageContextService),
      );
    };

    /** Повний, коректний набір споживачів із маніфесту */
    const allDeclared = (): { definition: unknown; id: string }[] =>
      MESSAGE_TOPOLOGY.flatMap((entry) =>
        entry.consumers.map((consumer) => ({ definition: entry.definition, id: consumer.id })),
      );

    it('повний набір споживачів стартує без помилок', async () => {
      await expect(registrarWith(allDeclared()).onApplicationBootstrap()).resolves.toBeUndefined();
    });

    it('оголошений у маніфесті споживач БЕЗ класу — краш', async () => {
      const incomplete = allDeclared().slice(1);
      await expect(registrarWith(incomplete).onApplicationBootstrap()).rejects.toThrow(
        /without a class/,
      );
    });

    it('клас БЕЗ запису в маніфесті — краш (мертвий код, у чергу ніхто не пише)', async () => {
      const extra = [
        ...allDeclared(),
        { definition: userRegisteredEvent, id: 'never-declared' },
      ];
      await expect(registrarWith(extra).onApplicationBootstrap()).rejects.toThrow(
        /without a manifest entry/,
      );
    });
  });

  describe('Inbox — ідемпотентність по бізнес-факту, а не по job-у', () => {
    // MessageInboxService живе у MessagingModule.forWorker(), а AppModule — продюсер.
    // Створюємо напряму з реального TenantTransactions: тест не має вимагати змін
    // у продакшн-проводці заради власної зручності.
    const inboxOf = (): MessageInboxService =>
      new MessageInboxService(app.get(TenantTransactions));

    const envelopeFor = (messageId: string): MessageEnvelope => ({
      messageId,
      name: userRegisteredEvent.name,
      occurredAt: new Date().toISOString(),
      tenantId: DEFAULT_TENANT_ID,
      actor: { type: 'system' },
      correlationId: 'test-correlation',
      causationId: null,
      data: {},
    });

    /** Inbox пише через withTenantTx — потрібен tenant-контекст, як у воркері */
    const runInTenant = async <T>(fn: () => Promise<T>): Promise<T> =>
      app.get(TenantContextService).runWith(DEFAULT_TENANT_ID, fn);

    beforeEach(async () => {
      await prisma.processedJob.deleteMany();
    });

    it('той самий messageId для того самого споживача виконується РАЗ', async () => {
      const envelope = envelopeFor(randomUUID());
      let calls = 0;

      const first = await runInTenant(() =>
        inboxOf().runOnce(envelope, 'welcome-email', async () => {
          calls += 1;
        }),
      );
      const second = await runInTenant(() =>
        inboxOf().runOnce(envelope, 'welcome-email', async () => {
          calls += 1;
        }),
      );

      expect(first).toBe('processed');
      expect(second).toBe('skipped');
      expect(calls).toBe(1);
    });

    it('різні споживачі обробляють ОДНЕ повідомлення незалежно', async () => {
      // Саме це ламалося б, якби ключем був лише messageId без суфікса споживача:
      // перший підписник «з'їдав» би подію в решти
      const envelope = envelopeFor(randomUUID());
      const calls: string[] = [];

      const a = await runInTenant(() =>
        inboxOf().runOnce(envelope, 'consumer-a', async () => {
          calls.push('a');
        }),
      );
      const b = await runInTenant(() =>
        inboxOf().runOnce(envelope, 'consumer-b', async () => {
          calls.push('b');
        }),
      );

      expect([a, b]).toEqual(['processed', 'processed']);
      expect(calls).toEqual(['a', 'b']);
    });

    it('повторна ПУБЛІКАЦІЯ того самого факту дає новий messageId і виконується знову', async () => {
      // Дзеркало попереднього: inbox захищає від ретраїв, а не від свідомого повтору
      let calls = 0;
      for (const messageId of [randomUUID(), randomUUID()]) {
        await runInTenant(() =>
          inboxOf().runOnce(envelopeFor(messageId), 'welcome-email', async () => {
            calls += 1;
          }),
        );
      }
      expect(calls).toBe(2);
    });

    it('маркер ідемпотентності лягає під ключем messageId:consumerId', async () => {
      const envelope = envelopeFor(randomUUID());
      await runInTenant(() => inboxOf().runOnce(envelope, 'welcome-email', async () => undefined));

      const marker = await prisma.processedJob.findUnique({
        where: { id: `${envelope.messageId}:welcome-email` },
      });
      expect(marker).not.toBeNull();
      expect(marker?.jobName).toBe(userRegisteredEvent.name);
    });
  });
});
