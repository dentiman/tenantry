/// <reference types="jest" />

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
// MT-2: прямі доступи тестів — під BYPASSRLS (поза tenant-контекстом RLS дав би 0 рядків)
import { SystemPrismaService } from '@saas-skeleton/database';
import { createAndLoginTestUser, createTestUser, DEFAULT_TENANT_ID } from './test-users';

interface CustomerBody {
  id: string;
  number: number;
  numberLabel: string;
  name: string;
  kind: string;
  status: string;
  ownerId: string | null;
  owner: { id: string; email: string } | null;
  currency: string;
  locale: string;
  tags: string[];
  email: string | null;
  externalId: string | null;
  contacts: { id: string; name: string; isPrimary: boolean }[];
  contactsCount: number;
}

describe('Customers API (e2e)', () => {
  let app: INestApplication;
  let prisma: SystemPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(SystemPrismaService);
  });

  beforeEach(async () => {
    await prisma.customerContact.deleteMany();
    await prisma.customer.deleteMany();
    // Лічильник нумерації скидається разом із кастомерами — інакше номери
    // «пливли» б між тестами і перевірка формату стала б нестабільною
    await prisma.numberSequence.deleteMany();
    await prisma.numberSeries.deleteMany();
    await prisma.activityLink.deleteMany();
    await prisma.activity.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.notificationState.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const admin = async (
    suffix: string,
  ): Promise<{ headers: { Authorization: string }; id: string; email: string }> => {
    const email = `admin-${suffix}@example.com`;
    const { user, tokens } = await createAndLoginTestUser(app, prisma, {
      email,
      password: 'SecurePass123',
      name: `Admin ${suffix}`,
      role: 'ADMIN',
    });
    return { headers: { Authorization: `Bearer ${tokens.accessToken}` }, id: user.id, email };
  };

  const createCustomer = async (
    headers: { Authorization: string },
    body: Record<string, unknown> = {},
  ): Promise<CustomerBody> => {
    const response = await request(app.getHttpServer())
      .post('/api/customers')
      .set(headers)
      .send({ name: 'Acme Inc', ...body })
      .expect(201);
    return response.body as CustomerBody;
  };

  it('creates a customer with only a name and assigns a human-readable number', async () => {
    const { headers, id: actorId } = await admin(`${Date.now()}-create`);

    const customer = await createCustomer(headers);

    expect(customer).toEqual(
      expect.objectContaining({
        // Номер — ціле число; 'C-000001' — presentation з конфігу серії
        number: 1,
        numberLabel: 'C-000001',
        name: 'Acme Inc',
        kind: 'ORGANIZATION',
        status: 'ACTIVE',
        currency: 'USD',
        // Відповідальний за замовчуванням — автор дії
        ownerId: actorId,
        contactsCount: 0,
      }),
    );
    expect(customer.contacts).toEqual([]);
    // tenantId назовні не витікає (як і в users)
    expect(customer).not.toHaveProperty('tenantId');
  });

  it('increments the number per tenant and never reuses it after delete', async () => {
    const { headers } = await admin(`${Date.now()}-numbers`);

    const first = await createCustomer(headers, { name: 'First' });
    const second = await createCustomer(headers, { name: 'Second' });
    expect([first.number, second.number]).toEqual([1, 2]);

    await request(app.getHttpServer())
      .delete(`/api/customers/${second.id}`)
      .set(headers)
      .expect(204);

    const third = await createCustomer(headers, { name: 'Third' });
    expect(third.number).toBe(3);
  });

  it('gives concurrent creations distinct numbers', async () => {
    const { headers } = await admin(`${Date.now()}-concurrent`);

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/customers')
          .set(headers)
          .send({ name: `Parallel ${String(i)}` })
          .expect(201),
      ),
    );

    const numbers = responses.map((r) => (r.body as CustomerBody).number);
    expect(new Set(numbers).size).toBe(5);
  });

  it('records customer.created in the activity feed of the customer', async () => {
    const { headers, email } = await admin(`${Date.now()}-activity`);
    const customer = await createCustomer(headers, { name: 'Feed Co' });

    const feed = await request(app.getHttpServer())
      .get('/api/activities')
      .query({ entityType: 'customer', entityId: customer.id })
      .set(headers)
      .expect(200);

    const items = (feed.body as { items: { type: string; actorLabel: string; payload: unknown }[] })
      .items;
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        type: 'customer.created',
        actorLabel: email,
        payload: { customer: { kind: 'customer', id: customer.id, label: 'Feed Co' } },
      }),
    );
  });

  it('notifies the owner when someone else assigns a customer to them', async () => {
    const { headers } = await admin(`${Date.now()}-notify`);
    const owner = await createTestUser(prisma, { email: `owner-${Date.now()}@example.com` });

    await createCustomer(headers, { name: 'Assigned Co', ownerId: owner.id });

    const notifications = await prisma.notification.findMany({ where: { recipientId: owner.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe('customer.assigned');

    // Собі сповіщення не приходить — це правило recorder-а, і воно тут перевіряється
    // на найчастішому випадку: адмін заводить кастомера сам на себе
    await createCustomer(headers, { name: 'Own Co' });
    const mine = await prisma.notification.count({ where: { type: 'customer.assigned' } });
    expect(mine).toBe(1);
  });

  it('hides archived customers from the default list but keeps them reachable', async () => {
    const { headers } = await admin(`${Date.now()}-archive`);
    const customer = await createCustomer(headers, { name: 'Archive Co' });

    await request(app.getHttpServer())
      .patch(`/api/customers/${customer.id}/status`)
      .set(headers)
      .send({ status: 'ARCHIVED' })
      .expect(200);

    const defaultList = await request(app.getHttpServer())
      .get('/api/customers')
      .set(headers)
      .expect(200);
    expect((defaultList.body as { items: CustomerBody[] }).items).toHaveLength(0);

    const explicit = await request(app.getHttpServer())
      .get('/api/customers')
      .query({ status: 'ARCHIVED' })
      .set(headers)
      .expect(200);
    expect((explicit.body as { items: CustomerBody[] }).items).toHaveLength(1);

    // За прямим посиланням архівний доступний — архів не є видаленням
    await request(app.getHttpServer())
      .get(`/api/customers/${customer.id}`)
      .set(headers)
      .expect(200);
  });

  it('writes archive/restore to the journal but stays silent on a no-op status change', async () => {
    const { headers } = await admin(`${Date.now()}-status-journal`);
    const customer = await createCustomer(headers, { name: 'Journal Co' });

    const setStatus = (status: string): request.Test =>
      request(app.getHttpServer())
        .patch(`/api/customers/${customer.id}/status`)
        .set(headers)
        .send({ status })
        .expect(200);

    await setStatus('ARCHIVED');
    // Повторний виклик із тим самим значенням — no-op: журнал фіксує зміну,
    // а не натискання кнопки
    await setStatus('ARCHIVED');
    await setStatus('ACTIVE');

    const feed = await request(app.getHttpServer())
      .get('/api/activities')
      .query({ entityType: 'customer', entityId: customer.id })
      .set(headers)
      .expect(200);

    const types = (feed.body as { items: { type: string }[] }).items.map((i) => i.type);
    expect(types).toEqual(['customer.restored', 'customer.archived', 'customer.created']);
  });

  /**
   * Регресія 2026-09-08 (той самий клас, що в календарі й users): `.partial()`
   * зберігає `.default()`, тож PATCH з одним полем перетворював контакт-ПЕРСОНУ
   * на ORGANIZATION.
   */
  it('patching one field keeps kind and locale untouched', async () => {
    const { headers } = await admin(`${Date.now()}-defaults`);
    const person = await createCustomer(headers, { name: 'Jane Roe', kind: 'PERSON' });
    expect(person.kind).toBe('PERSON');

    const patched = await request(app.getHttpServer())
      .patch(`/api/customers/${person.id}`)
      .set(headers)
      .send({ notes: 'called back' })
      .expect(200);

    expect(patched.body).toEqual(
      expect.objectContaining({ kind: 'PERSON', locale: person.locale }),
    );
  });

  it('records owner changes only, not ordinary field edits', async () => {
    const { headers } = await admin(`${Date.now()}-owner`);
    const owner = await createTestUser(prisma, { email: `newowner-${Date.now()}@example.com` });
    const customer = await createCustomer(headers, { name: 'Owner Co' });

    await request(app.getHttpServer())
      .patch(`/api/customers/${customer.id}`)
      .set(headers)
      .send({ notes: 'Called them on Monday', city: 'Kyiv' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/customers/${customer.id}`)
      .set(headers)
      .send({ ownerId: owner.id })
      .expect(200);

    const feed = await request(app.getHttpServer())
      .get('/api/activities')
      .query({ entityType: 'customer', entityId: customer.id })
      .set(headers)
      .expect(200);

    const types = (feed.body as { items: { type: string }[] }).items.map((i) => i.type);
    expect(types).toEqual(['customer.owner_changed', 'customer.created']);
  });

  it('rejects an unknown owner with a field error', async () => {
    const { headers } = await admin(`${Date.now()}-bad-owner`);

    const response = await request(app.getHttpServer())
      .post('/api/customers')
      .set(headers)
      .send({ name: 'Bad Owner Co', ownerId: '00000000-0000-4000-8000-0000000000ff' })
      .expect(400);

    expect((response.body as { fieldErrors: { field: string }[] }).fieldErrors[0]?.field).toBe(
      'ownerId',
    );
  });

  it('filters by search, status, kind, owner and tag', async () => {
    const { headers, id: actorId } = await admin(`${Date.now()}-filters`);
    await createCustomer(headers, {
      name: 'Northwind Traders',
      taxId: 'UA123456',
      tags: ['vip'],
    });
    await createCustomer(headers, { name: 'Southwind', kind: 'PERSON', ownerId: null });

    const byName = await request(app.getHttpServer())
      .get('/api/customers')
      .query({ search: 'northwind' })
      .set(headers)
      .expect(200);
    expect((byName.body as { items: CustomerBody[] }).items).toHaveLength(1);

    // Пошук по номеру і податковому номеру — не тільки по назві
    const byTaxId = await request(app.getHttpServer())
      .get('/api/customers')
      .query({ search: 'UA1234' })
      .set(headers)
      .expect(200);
    expect((byTaxId.body as { items: CustomerBody[] }).items).toHaveLength(1);

    // Номер шукається точним збігом по цифрах: 'C-000001', '000001' і '1' —
    // той самий запис
    for (const term of ['C-000001', '000001', '1']) {
      const byNumber = await request(app.getHttpServer())
        .get('/api/customers')
        .query({ search: term })
        .set(headers)
        .expect(200);
      const items = (byNumber.body as { items: CustomerBody[] }).items;
      expect(items).toHaveLength(1);
      expect(items[0]?.number).toBe(1);
    }

    const byKind = await request(app.getHttpServer())
      .get('/api/customers')
      .query({ kind: 'PERSON' })
      .set(headers)
      .expect(200);
    expect((byKind.body as { items: CustomerBody[] }).items).toHaveLength(1);

    const byOwner = await request(app.getHttpServer())
      .get('/api/customers')
      .query({ ownerId: actorId })
      .set(headers)
      .expect(200);
    expect((byOwner.body as { items: CustomerBody[] }).items).toHaveLength(1);

    const byTag = await request(app.getHttpServer())
      .get('/api/customers')
      .query({ tag: 'vip' })
      .set(headers)
      .expect(200);
    expect((byTag.body as { items: CustomerBody[] }).items).toHaveLength(1);
  });

  it('keeps exactly one primary contact and cascades contacts on delete', async () => {
    const { headers } = await admin(`${Date.now()}-contacts`);
    const customer = await createCustomer(headers, { name: 'Contacts Co' });

    const addContact = (body: Record<string, unknown>): request.Test =>
      request(app.getHttpServer())
        .post(`/api/customers/${customer.id}/contacts`)
        .set(headers)
        .send(body)
        .expect(201);

    await addContact({ name: 'First Contact', isPrimary: true, position: 'CFO' });
    await addContact({ name: 'Second Contact', isPrimary: true });

    const detail = await request(app.getHttpServer())
      .get(`/api/customers/${customer.id}`)
      .set(headers)
      .expect(200);
    const body = detail.body as CustomerBody;

    expect(body.contactsCount).toBe(2);
    expect(body.contacts.filter((c) => c.isPrimary)).toHaveLength(1);
    // Основний іде першим — порядок картки не має «стрибати»
    expect(body.contacts[0]?.name).toBe('Second Contact');

    await request(app.getHttpServer())
      .delete(`/api/customers/${customer.id}`)
      .set(headers)
      .expect(204);
    expect(await prisma.customerContact.count()).toBe(0);
  });

  it('does not let a contact be addressed through another customer', async () => {
    const { headers } = await admin(`${Date.now()}-contact-scope`);
    const owner = await createCustomer(headers, { name: 'Owner Co' });
    const other = await createCustomer(headers, { name: 'Other Co' });

    const created = await request(app.getHttpServer())
      .post(`/api/customers/${owner.id}/contacts`)
      .set(headers)
      .send({ name: 'Contact' })
      .expect(201);
    const contactId = (created.body as { id: string }).id;

    await request(app.getHttpServer())
      .patch(`/api/customers/${other.id}/contacts/${contactId}`)
      .set(headers)
      .send({ name: 'Hijacked' })
      .expect(404);
  });

  it('rejects a duplicate externalId — the only hard uniqueness besides the number', async () => {
    const { headers } = await admin(`${Date.now()}-external`);
    await createCustomer(headers, { name: 'Imported', externalId: 'legacy-42' });

    const response = await request(app.getHttpServer())
      .post('/api/customers')
      .set(headers)
      .send({ name: 'Imported again', externalId: 'legacy-42' })
      .expect(400);
    expect((response.body as { fieldErrors: { field: string }[] }).fieldErrors[0]?.field).toBe(
      'externalId',
    );

    // Однакові назви, пошта і податковий номер — легальні: дублікати ловить merge,
    // а не констрейнт (інакше в базі з'являється «ТОВ Ромашка 2»)
    await createCustomer(headers, { name: 'Imported', email: 'same@example.com' });
    await createCustomer(headers, { name: 'Imported', email: 'same@example.com' });
  });

  it('normalizes empty strings from forms to null and derives the phone country', async () => {
    const { headers } = await admin(`${Date.now()}-normalize`);

    const customer = await createCustomer(headers, {
      name: 'Normalize Co',
      email: '',
      notes: '',
      phone: '+380671234567',
    });

    expect(customer.email).toBeNull();
    const row = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(row?.notes).toBeNull();
    expect(row?.phoneCountry).toBe('UA');
  });

  it('does not expose customers of another tenant', async () => {
    const { headers } = await admin(`${Date.now()}-isolation`);
    const mine = await createCustomer(headers, { name: 'Mine' });

    const otherTenant = await prisma.tenant.create({
      data: { slug: `other-${String(Date.now())}`, name: 'Other' },
    });
    const foreign = await prisma.customer.create({
      data: {
        tenantId: otherTenant.id,
        // Той самий номер, що й у нашого — і це легально: нумерація своя в
        // кожного тенанта, не наскрізна
        number: 1,
        name: 'Foreign Co',
      },
    });

    const list = await request(app.getHttpServer()).get('/api/customers').set(headers).expect(200);
    const items = (list.body as { items: CustomerBody[] }).items;
    expect(items.map((c) => c.id)).toEqual([mine.id]);

    // Чужий id → 404, а не 403: існування чужого рядка не палимо
    await request(app.getHttpServer())
      .get(`/api/customers/${foreign.id}`)
      .set(headers)
      .expect(404);

    await prisma.customer.deleteMany({ where: { tenantId: otherTenant.id } });
    await prisma.tenant.delete({ where: { id: otherTenant.id } });
  });

  it('numbers customers per tenant, not globally', async () => {
    const { headers } = await admin(`${Date.now()}-per-tenant`);
    await createCustomer(headers, { name: 'Mine' });

    const otherTenant = await prisma.tenant.create({
      data: { slug: `numbered-${String(Date.now())}`, name: 'Other' },
    });
    await createTestUser(prisma, { email: `other-admin-${Date.now()}@example.com` });

    // Другий тенант починає нумерацію зі свого першого номера — лічильник
    // на (tenant, простір), а не глобальна послідовність
    const seq = await prisma.numberSequence.findMany({ where: { tenantId: DEFAULT_TENANT_ID } });
    expect(seq).toHaveLength(1);
    expect(seq[0]?.lastValue).toBe(1);
    // Бакет скидання порожній: майстер-дані нумеруються наскрізно
    expect(seq[0]?.scope).toBe('');
    expect(
      await prisma.numberSequence.count({ where: { tenantId: otherTenant.id } }),
    ).toBe(0);

    await prisma.tenant.delete({ where: { id: otherTenant.id } });
  });
});
