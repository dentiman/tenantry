/// <reference types="jest" />

// EDA-1: захисна сітка навколо конвеєра повідомлень
// (docs/event-driven-architecture.md). Три властивості, кожна закриває конкретний
// розрив з §2 того документа.

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  Prisma,
  SystemPrismaModule, SystemPrismaService,
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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, SystemPrismaModule] }).compile();
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
      const wrappers = subscribers.map((meta) => ({
        instance: { handle: async () => undefined },
        meta,
      }));
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
      const extra = [...allDeclared(), { definition: userRegisteredEvent, id: 'never-declared' }];
      await expect(registrarWith(extra).onApplicationBootstrap()).rejects.toThrow(
        /without a manifest entry/,
      );
    });
  });

  describe('Inbox — ідемпотентність за messageId і consumerId', () => {
    // MessageInboxService живе у MessagingModule.forWorker(), а AppModule — продюсер.
    // Створюємо напряму з реального TenantTransactions: тест не має вимагати змін
    // у продакшн-проводці заради власної зручності.
    const inboxOf = (): MessageInboxService => new MessageInboxService(app.get(TenantTransactions));

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

    const customerName = `inbox-test-${randomUUID()}`;
    let nextCustomerNumber = 900_000_000;

    /** Бізнесовий ефект для тестів: рядок customers із унікальними (tenant, number) і (tenant, external_id) */
    const customerData = (
      externalId: string,
      number: number,
    ): Prisma.CustomerUncheckedCreateInput => ({
      name: customerName,
      number,
      externalId,
      tenantId: DEFAULT_TENANT_ID,
    });
    const uniqueNumber = (): number => nextCustomerNumber++;
    const customersOf = (externalIds: string[]): Promise<number> =>
      prisma.customer.count({
        where: { tenantId: DEFAULT_TENANT_ID, externalId: { in: externalIds } },
      });

    beforeEach(async () => {
      await prisma.processedJob.deleteMany();
    });

    afterEach(async () => {
      await prisma.customer.deleteMany({ where: { name: customerName } });
    });

    it('той самий messageId для того самого споживача виконується РАЗ', async () => {
      const envelope = envelopeFor(randomUUID());
      const externalId = randomUUID();
      let calls = 0;
      const effect = async (tx: Prisma.TransactionClient): Promise<void> => {
        calls += 1;
        // другий виклик, якби він дійшов до fn, впав би на unique (tenant, external_id)
        await tx.customer.create({ data: customerData(externalId, uniqueNumber()) });
      };

      const first = await runInTenant(() => inboxOf().runOnce(envelope, 'welcome-email', effect));
      const second = await runInTenant(() => inboxOf().runOnce(envelope, 'welcome-email', effect));

      expect(first).toBe('processed');
      expect(second).toBe('skipped');
      expect(calls).toBe(1);
      expect(await customersOf([externalId])).toBe(1);
    });

    it('бізнесовий P2002 усередині fn НЕ ковтається: маркер і ефекти відкочуються, ретрай можливий', async () => {
      const envelope = envelopeFor(randomUUID());
      const duplicated = randomUUID();
      const earlier = randomUUID();

      // Перші два записи успішні, третій порушує unique (tenant_id, external_id)
      const failure = await runInTenant(() =>
        inboxOf().runOnce(envelope, 'welcome-email', async (tx) => {
          await tx.customer.create({ data: customerData(earlier, uniqueNumber()) });
          await tx.customer.create({ data: customerData(duplicated, uniqueNumber()) });
          await tx.customer.create({ data: customerData(duplicated, uniqueNumber()) });
        }),
      ).then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((failure as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
      expect(
        await prisma.processedJob.count({ where: { id: `${envelope.messageId}:welcome-email` } }),
      ).toBe(0);
      expect(await customersOf([earlier, duplicated])).toBe(0);

      // Причину усунено — та сама доставка виконується, а не «skipped»
      const retry = await runInTenant(() =>
        inboxOf().runOnce(envelope, 'welcome-email', async (tx) => {
          await tx.customer.create({ data: customerData(earlier, uniqueNumber()) });
          await tx.customer.create({ data: customerData(duplicated, uniqueNumber()) });
        }),
      );
      expect(retry).toBe('processed');
      expect(await customersOf([earlier, duplicated])).toBe(2);
    });

    it('звичайна помилка fn іде назовні, а маркер і ефекти відкочуються', async () => {
      const envelope = envelopeFor(randomUUID());
      const externalId = randomUUID();

      await expect(
        runInTenant(() =>
          inboxOf().runOnce(envelope, 'welcome-email', async (tx) => {
            await tx.customer.create({ data: customerData(externalId, uniqueNumber()) });
            throw new Error('boom');
          }),
        ),
      ).rejects.toThrow('boom');

      expect(
        await prisma.processedJob.count({ where: { id: `${envelope.messageId}:welcome-email` } }),
      ).toBe(0);
      expect(await customersOf([externalId])).toBe(0);
    });

    it.each(['commit', 'rollback'] as const)(
      'конкурентний runOnce після %s першої доставки: один збережений ефект',
      async (finish) => {
        const envelope = envelopeFor(randomUUID());
        const externalIds = [randomUUID(), randomUUID()] as const;
        const rollbackError = new Error('first delivery rolled back');
        let calls = 0;
        let firstPid = 0;

        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let markEntered!: () => void;
        const firstEntered = new Promise<void>((resolve) => {
          markEntered = resolve;
        });

        // A тримає маркер незакоміченим; PID звужує перевірку саме до її блокувань.
        const a = runInTenant(() =>
          inboxOf().runOnce(envelope, 'welcome-email', async (tx) => {
            calls += 1;
            const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
            if (!backend) throw new Error('Postgres did not return the backend PID');
            firstPid = backend.pid;
            await tx.customer.create({ data: customerData(externalIds[0], uniqueNumber()) });
            markEntered();
            await gate;
            if (finish === 'rollback') throw rollbackError;
          }),
        );
        let b: Promise<'processed' | 'skipped'> | undefined;

        try {
          // Помилка A до відкриття воріт має завершити тест, а не лишити його завислим.
          await Promise.race([
            firstEntered,
            a.then(() => {
              throw new Error('First delivery completed before entering the gate');
            }),
          ]);

          b = runInTenant(() =>
            inboxOf().runOnce(envelope, 'welcome-email', async (tx) => {
              calls += 1;
              await tx.customer.create({ data: customerData(externalIds[1], uniqueNumber()) });
            }),
          );
          // Одразу підписуємось на обидві помилки, зокрема на очікуваний rollback A.
          const settled = Promise.allSettled([a, b]);

          // Чекаємо фактичного конфлікту з A, а не стороннього lock у цьому Postgres.
          // Дедлайн коротший за стандартний timeout інтерактивної транзакції (5 с).
          const deadline = Date.now() + 3_000;
          let blocked = false;
          while (!blocked && Date.now() < deadline) {
            const [row] = await prisma.$queryRaw<{ blocked: boolean }[]>`
              SELECT EXISTS (
                SELECT 1 FROM pg_locks
                WHERE NOT granted
                  AND locktype = 'transactionid'
                  AND ${firstPid} = ANY(pg_blocking_pids(pid))
              ) AS blocked`;
            if (!row) throw new Error('Postgres did not return the lock status');
            blocked = row.blocked;
            if (!blocked) await new Promise((resolve) => setImmediate(resolve));
          }
          expect(blocked).toBe(true);
          release();

          const [first, second] = await settled;
          if (finish === 'commit') {
            expect(first).toEqual({ status: 'fulfilled', value: 'processed' });
            expect(second).toEqual({ status: 'fulfilled', value: 'skipped' });
            expect(calls).toBe(1);
            expect(await customersOf([externalIds[0]])).toBe(1);
            expect(await customersOf([externalIds[1]])).toBe(0);
          } else {
            expect(first).toEqual({ status: 'rejected', reason: rollbackError });
            expect(second).toEqual({ status: 'fulfilled', value: 'processed' });
            expect(calls).toBe(2);
            expect(await customersOf([externalIds[0]])).toBe(0);
            expect(await customersOf([externalIds[1]])).toBe(1);
          }
          expect(
            await prisma.processedJob.count({
              where: { id: `${envelope.messageId}:welcome-email` },
            }),
          ).toBe(1);
        } finally {
          // Навіть невдала перевірка lock-у звільняє gate й завершує обидві доставки
          // ДО afterEach/app.close, без фонових записів чи необроблених rejection-ів.
          release();
          await Promise.allSettled(b ? [a, b] : [a]);
        }
      },
      30_000,
    );

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
