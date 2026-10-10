import * as argon2 from 'argon2';
import {
  ACTIVITY_PAYLOAD_SCHEMAS,
  CALENDAR_SETTINGS_DEFAULTS,
  NOTIFICATION_PAYLOAD_SCHEMAS,
  PhoneNumberSchema,
  type ActivityType,
  type NotificationType,
} from '../../../contracts/src';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../../contracts/src/demo';
import { ensureDefaultChannel, joinDefaultChannel } from '../../../shared/src/chat/default-channel';
import { Prisma, type PrismaClient } from '../../src/generated/prisma/client';
import { domainOf, personName, phoneFor, slugOfName } from './people';
import type { DemoEventSpec, DemoTenantDataset } from './types';
import { DAY, HOUR, MINUTE, allDayStart, atWorkday, createRng, uid } from './util';

/** `users`/`events` — оновлені upsert-ом (завжди весь датасет); решта — РЯДКИ, ДОДАНІ цим запуском (на повторному 0) */
export interface TenantSeedStats {
  slug: string;
  users: number;
  events: number;
  customers: number;
  contacts: number;
  messages: number;
  activities: number;
  notifications: number;
}

interface SeededUser {
  id: string;
  email: string;
  name: string;
  active: boolean;
  createdAt: Date;
}

interface SeededCustomer {
  id: string;
  name: string;
  ownerIdx: number | null;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  createdAt: Date;
  updatedAt: Date;
}

interface SeededEvent {
  spec: DemoEventSpec;
  id: string;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  customerIdx: number | undefined;
}

interface ActivityDraft {
  key: string;
  type: ActivityType;
  actorIdx: number | null;
  payload: Record<string, unknown>;
  links: { entityType: string; entityId: string; role: 'subject' | 'context' | 'target' }[];
  at: Date;
}

interface NotificationDraft {
  key: string;
  recipientIdx: number;
  type: NotificationType;
  payload: Record<string, unknown>;
  target?: { kind: string; id: string };
  actorIdx: number | null;
  at: Date;
  read: boolean;
  groupKey?: string;
  groupCount?: number;
}

const STREETS = ['High Street', 'Station Road', 'Harbour Lane', 'Market Square', 'Park Avenue', 'Mill Road', 'Kings Way', 'Main Street', 'Elm Street', 'Canal Street'];

const ref = (kind: string, id: string, label: string): { kind: string; id: string; label: string } => ({ kind, id, label });
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const digits = (rng: ReturnType<typeof createRng>, count: number): string => Array.from({ length: count }, () => String(rng.int(0, 9))).join('');

/**
 * Сідить ОДИН демо-тенант. Ідемпотентно: стабільні id (`uid`) + upsert / skipDuplicates; повторний
 * запуск оновлює зсувні дані (дати календаря), нічого не дублює. Усе пишеться під `saas_platform`
 * (BYPASSRLS) з явним `tenantId` — DB-default `current_setting('app.tenant_id')` тут порожній.
 *
 * Бізнес-інваріанти, які в рантаймі тримають сервіси (журнал, сповіщення, чат, нумерація),
 * відтворено напряму, а payload-и журналу й сповіщень валідуються ТИМИ САМИМИ Zod-схемами,
 * що й recorder-и, — демо не може розійтись із контрактом, який читає фронт.
 */
export async function seedTenant(
  prisma: PrismaClient,
  data: DemoTenantDataset,
  now: Date,
  log: (message: string) => void,
): Promise<TenantSeedStats> {
  const { slug } = data;
  const tz = data.timeZone;

  // ── Тенант ────────────────────────────────────────────────────────────────
  const settings = {
    calendar: {
      ...CALENDAR_SETTINGS_DEFAULTS,
      timeZone: tz,
      workDayStart: data.workDay.start,
      workDayEnd: data.workDay.end,
    },
  };
  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: {
      id: uid('tenant', slug),
      slug,
      name: data.name,
      currency: data.currency,
      locale: 'en',
      settings,
      createdAt: new Date(now.getTime() - data.createdDaysAgo * DAY),
    },
    update: { name: data.name, currency: data.currency, isActive: true, settings },
  });
  const tenantId = tenant.id;

  // ── Юзери ─────────────────────────────────────────────────────────────────
  const hashCache = new Map<string, string>();
  const hashOf = async (password: string): Promise<string> => {
    const cached = hashCache.get(password);
    if (cached) return cached;
    const hash = await argon2.hash(password);
    hashCache.set(password, hash);
    return hash;
  };

  const users: SeededUser[] = [];
  for (const spec of data.users) {
    const account = DEMO_ACCOUNTS.find((a) => a.tenant === slug && a.email === spec.email);
    const phone = PhoneNumberSchema.safeParse(spec.phone).success ? spec.phone : null;
    const createdAt = new Date(now.getTime() - spec.createdDaysAgo * DAY);
    const id = uid(slug, 'user', spec.email);
    const common = {
      name: spec.name,
      role: spec.role,
      isActive: !spec.inactive,
      phone,
      phoneCountry: phone ? spec.phoneCountry : null,
      passwordHash: await hashOf(account?.password ?? DEMO_PASSWORD),
      lastSeenAt: spec.lastSeenMinutesAgo === undefined ? null : new Date(now.getTime() - spec.lastSeenMinutesAgo * MINUTE),
    };
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId, email: spec.email } },
      create: { id, tenantId, email: spec.email, locale: 'en', createdAt, updatedAt: createdAt, ...common },
      update: common,
    });
    // id існуючого рядка міг бути не детермінований (юзера колись створили руками) — читаємо справжній
    const stored = await prisma.user.findUniqueOrThrow({
      where: { tenantId_email: { tenantId, email: spec.email } },
      select: { id: true },
    });
    users.push({ id: stored.id, email: spec.email, name: spec.name, active: !spec.inactive, createdAt });
  }
  const actorOf = (idx: number | null): { id: string; label: string } | null => {
    if (idx === null) return null;
    const user = users[idx];
    if (!user) throw new Error(`Unknown user index ${String(idx)} in ${slug}`);
    return { id: user.id, label: user.email };
  };
  const activeIdx = users.flatMap((u, i) => (u.active ? [i] : []));

  // ── Дефолтний канал (єдиний провізіонер, docs/modules.md §7.3) ────────────
  const general = await prisma.$transaction(
    async (tx) => {
      const channel = await ensureDefaultChannel(tx, tenantId);
      for (const idx of activeIdx) {
        const u = users[idx];
        if (u) await joinDefaultChannel(tx, tenantId, { id: u.id, name: u.name, email: u.email });
      }
      return channel;
    },
    { timeout: 120_000 },
  );

  // ── Кастомери ─────────────────────────────────────────────────────────────
  const allCustomers = [
    ...data.orgs.map((o) => ({ kind: 'ORGANIZATION' as const, spec: o })),
    ...data.persons.map((p) => ({ kind: 'PERSON' as const, spec: p })),
  ];
  const total = allCustomers.length;
  const existing = await prisma.customer.findMany({
    where: { tenantId, externalId: { startsWith: `demo-${slug}-` } },
    select: { externalId: true },
  });
  const existingExternal = new Set(existing.map((c) => c.externalId));
  const sequence = await prisma.numberSequence.findUnique({
    where: { tenantId_name_scope: { tenantId, name: 'customer', scope: '' } },
    select: { lastValue: true },
  });
  const maxNumber = await prisma.customer.aggregate({ where: { tenantId }, _max: { number: true } });
  let counter = Math.max(sequence?.lastValue ?? 0, maxNumber._max.number ?? 0);

  const customers: SeededCustomer[] = [];
  const customerRows: Prisma.CustomerCreateManyInput[] = [];
  const contactRows: Prisma.CustomerContactCreateManyInput[] = [];
  const spanDays = 210;

  allCustomers.forEach(({ kind, spec }, i) => {
    const rng = createRng(`${slug}:customer:${String(i)}`);
    const externalId = `demo-${slug}-${String(i + 1).padStart(3, '0')}`;
    const id = uid(slug, 'customer', i);
    const createdAt = new Date(now.getTime() - ((total - i) * spanDays * DAY) / total - rng.int(1, 10) * HOUR);
    const sinceDays = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / DAY));
    const updatedAt = new Date(Math.min(now.getTime() - HOUR, createdAt.getTime() + rng.int(0, Math.min(45, sinceDays)) * DAY));
    const status = spec.status ?? 'ACTIVE';
    // Кожен дев'ятий — «нічий»: легальний стан, його видно у фільтрі за відповідальним
    const ownerIdx = i % 9 === 8 ? null : (activeIdx[i % activeIdx.length] ?? null);
    customers.push({ id, name: spec.name, ownerIdx, status, createdAt, updatedAt });

    if (existingExternal.has(externalId)) return;
    counter += 1;

    const isOrg = kind === 'ORGANIZATION';
    const org = 'legalSuffix' in spec ? spec : null;
    const domain = domainOf(spec.name);
    const phone = phoneFor(spec.country, rng);
    const taxId = !isOrg ? null : spec.country === 'US' ? `${digits(rng, 2)}-${digits(rng, 7)}` : `${spec.country}${digits(rng, 9)}`;

    customerRows.push({
      id,
      tenantId,
      externalId,
      number: counter,
      kind,
      status,
      name: spec.name,
      legalName: org ? (org.legalSuffix ? `${org.name} ${org.legalSuffix}` : org.name) : null,
      email: isOrg ? `accounts@${domain}` : `${slugOfName(spec.name)}@mail.example`,
      phone,
      phoneCountry: phone ? spec.country : null,
      website: isOrg ? `https://www.${domain}` : null,
      taxId,
      currency: spec.currency ?? data.currency,
      locale: 'en',
      ownerId: ownerIdx === null ? null : (users[ownerIdx]?.id ?? null),
      tags: spec.tags ?? [],
      notes: spec.notes ?? (rng.chance(0.22) ? rng.pick(data.notes) : null),
      addressLine1: `${String(rng.int(1, 240))} ${rng.pick(STREETS)}`,
      city: spec.city,
      region: org?.region ?? null,
      postalCode: digits(rng, 5),
      country: spec.country,
      createdById: users[0]?.id ?? null,
      createdAt,
      updatedAt,
    });

    // Контактні особи — лише в організацій: 1–3, перший основний
    if (isOrg) {
      const roll = rng.next();
      const count = roll < 0.35 ? 1 : roll < 0.8 ? 2 : 3;
      const titles = [...data.contactTitles];
      for (let j = 0; j < count; j += 1) {
        const name = personName(spec.country, rng);
        const title = titles.splice(rng.int(0, titles.length - 1), 1)[0] ?? data.contactTitles[0] ?? null;
        const contactPhone = rng.chance(0.65) ? phoneFor(spec.country, rng) : null;
        contactRows.push({
          id: uid(slug, 'contact', i, j),
          tenantId,
          customerId: id,
          name: `${name.first} ${name.last}`,
          position: title,
          email: `${slugOfName(`${name.first} ${name.last}`)}@${domain}`,
          phone: contactPhone,
          phoneCountry: contactPhone ? spec.country : null,
          isPrimary: j === 0,
          createdAt,
          updatedAt: createdAt,
        });
      }
    }
  });

  const addedCustomers = await prisma.customer.createMany({ data: customerRows, skipDuplicates: true });
  const addedContacts = await prisma.customerContact.createMany({ data: contactRows, skipDuplicates: true });
  await prisma.numberSequence.upsert({
    where: { tenantId_name_scope: { tenantId, name: 'customer', scope: '' } },
    create: { tenantId, name: 'customer', scope: '', lastValue: counter },
    update: { lastValue: counter },
  });

  // ── Календар ──────────────────────────────────────────────────────────────
  const events: SeededEvent[] = data.events.map((spec) => {
    const rng = createRng(`${slug}:event:${spec.key}`);
    const startsAt = spec.allDay ? allDayStart(now, spec.day, tz) : atWorkday(now, spec.day, spec.start, tz);
    const endsAt = new Date(startsAt.getTime() + spec.minutes * MINUTE);
    const lead = (spec.rescheduledFromDays ? 6 : 3) + rng.int(0, 4);
    const createdAt = new Date(Math.min(startsAt.getTime() - lead * DAY, now.getTime() - 2 * HOUR));
    return { spec, id: uid(slug, 'event', spec.key), startsAt, endsAt, createdAt, customerIdx: spec.customer };
  });

  const futureReminderKeys: Prisma.ScheduledNotificationCreateManyInput[] = [];
  for (const ev of events) {
    const { spec } = ev;
    const ownerId = users[spec.owner]?.id;
    if (!ownerId) throw new Error(`Event ${spec.key}: unknown owner ${String(spec.owner)}`);
    const customerId = ev.customerIdx === undefined ? null : (customers[ev.customerIdx]?.id ?? null);
    const fields = {
      title: spec.title,
      description: spec.description ?? null,
      location: spec.location ?? null,
      kind: spec.kind,
      status: spec.status ?? 'CONFIRMED',
      visibility: spec.visibility ?? 'DEFAULT',
      busy: spec.kind !== 'DEADLINE',
      startsAt: ev.startsAt,
      endsAt: ev.endsAt,
      timeZone: tz,
      allDay: spec.allDay ?? false,
      ownerId,
      customerId,
    };
    await prisma.calendarEvent.upsert({
      where: { id: ev.id },
      create: { id: ev.id, tenantId, createdById: ownerId, createdAt: ev.createdAt, updatedAt: ev.createdAt, ...fields },
      update: fields,
    });

    // Організатор — теж учасник, одразу ACCEPTED (так робить CalendarService.create)
    const attendees = [
      { user: spec.owner, response: 'ACCEPTED' as const, optional: false },
      ...spec.attendees.filter((a) => a.user !== spec.owner).map((a) => ({ ...a, optional: a.optional ?? false })),
    ];
    const rng = createRng(`${slug}:event:${spec.key}:rsvp`);
    await prisma.calendarEventAttendee.createMany({
      data: attendees.map((a) => {
        const userId = users[a.user]?.id;
        if (!userId) throw new Error(`Event ${spec.key}: unknown attendee ${String(a.user)}`);
        const answered = a.response !== 'NEEDS_ACTION';
        return {
          id: uid(slug, 'attendee', spec.key, a.user),
          tenantId,
          eventId: ev.id,
          userId,
          role: a.optional ? ('OPTIONAL' as const) : ('REQUIRED' as const),
          response: a.response,
          respondedAt: answered ? new Date(Math.min(ev.createdAt.getTime() + rng.int(1, 30) * HOUR, now.getTime() - HOUR)) : null,
          createdAt: ev.createdAt,
        };
      }),
      skipDuplicates: true,
    });

    // Нагадування — лише організатору й лише на майбутнє, як у сервісі (`reminders.create` — userId автора)
    const upcoming = ev.startsAt.getTime() > now.getTime() && (spec.status ?? 'CONFIRMED') !== 'CANCELLED';
    if (upcoming) {
      const minutesBefore = spec.allDay ? CALENDAR_SETTINGS_DEFAULTS.defaultAllDayReminderMinutes : CALENDAR_SETTINGS_DEFAULTS.defaultReminderMinutes;
      if (minutesBefore !== null) {
        const reminderId = uid(slug, 'reminder', spec.key);
        await prisma.calendarReminder.createMany({
          data: [{ id: reminderId, tenantId, eventId: ev.id, userId: ownerId, minutesBefore, channel: 'in_app' }],
          skipDuplicates: true,
        });
        const fireAt = new Date(ev.startsAt.getTime() - minutesBefore * MINUTE);
        if (fireAt.getTime() > now.getTime()) {
          futureReminderKeys.push({
            tenantId,
            fireAt,
            dedupeKey: `calendar_event:${ev.id}:reminder:${reminderId}:${ev.startsAt.toISOString()}`,
            recipientId: ownerId,
            type: 'calendar_event.reminder',
            payload: json(
              NOTIFICATION_PAYLOAD_SCHEMAS['calendar_event.reminder'].parse({
                event: ref('calendar_event', ev.id, spec.title),
                startsAt: ev.startsAt.toISOString(),
                allDay: spec.allDay ?? false,
                minutesBefore,
              }),
            ),
            targetKind: 'calendar_event',
            targetId: ev.id,
            actorType: 'system',
          });
        }
      }
    }
  }
  // Дати зсунулись → старі нескановані нагадування прибираємо й пишемо нові (як rescheduleReminders)
  await prisma.scheduledNotification.deleteMany({
    where: { tenantId, claimedAt: null, deliveredAt: null, dedupeKey: { startsWith: 'calendar_event:' }, recipientId: { in: users.map((u) => u.id) } },
  });
  await prisma.scheduledNotification.createMany({ data: futureReminderKeys, skipDuplicates: true });

  // ── Чат ───────────────────────────────────────────────────────────────────
  let messageCount = 0;
  const channelBase = new Date(now.getTime() - 14 * DAY);
  for (const channel of data.channels) {
    const isDefault = channel.default === true;
    const conversationId = isDefault ? general.id : uid(slug, 'conversation', channel.key);

    if (!isDefault) {
      const found = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true } });
      if (found) continue;
      const first = channel.messages[0];
      const openedAt = new Date(now.getTime() - ((first?.minutesAgo ?? 60) + 90) * MINUTE);
      await prisma.conversation.create({
        data: {
          id: conversationId,
          tenantId,
          kind: 'INTERNAL',
          access: 'private',
          status: 'OPEN',
          title: channel.title ?? channel.key,
          lastSeq: 1,
          lastMessageAt: openedAt,
          createdAt: openedAt,
          updatedAt: openedAt,
        },
      });
      await prisma.chatMessage.create({
        data: {
          id: uid(slug, 'chat', channel.key, 'created'),
          tenantId,
          conversationId,
          seq: 1,
          kind: 'SYSTEM',
          senderType: 'system',
          payload: { type: 'conversation.created' },
          createdAt: openedAt,
        },
      });
      const memberIdx = channel.members ?? [];
      await prisma.conversationParticipant.createMany({
        data: memberIdx.flatMap((idx) => {
          const u = users[idx];
          return u ? [{ conversationId, tenantId, userId: u.id, role: 'member', joinSeq: 1, joinedAt: openedAt }] : [];
        }),
        skipDuplicates: true,
      });
    } else {
      const hasText = await prisma.chatMessage.count({ where: { conversationId, kind: 'TEXT' } });
      if (hasText > 0) continue;
      // Системні записи провізіонера мають «зараз» — переносимо їх у минуле, щоб стрічка читалась
      // хронологічно (conversation.created → member.added … → розмова)
      const system = await prisma.chatMessage.findMany({ where: { conversationId, kind: 'SYSTEM' }, orderBy: { seq: 'asc' }, select: { id: true, seq: true } });
      for (const row of system) {
        await prisma.chatMessage.update({ where: { id: row.id }, data: { createdAt: new Date(channelBase.getTime() + row.seq * MINUTE) } });
      }
      await prisma.conversation.update({ where: { id: conversationId }, data: { createdAt: channelBase } });
    }

    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { lastSeq: true } });
    const startSeq = conv.lastSeq;
    const rows: Prisma.ChatMessageCreateManyInput[] = channel.messages.map((msg, n) => {
      const sender = users[msg.by];
      if (!sender) throw new Error(`Chat ${channel.key}: unknown sender ${String(msg.by)}`);
      return {
        id: uid(slug, 'chat', channel.key, n),
        tenantId,
        conversationId,
        seq: startSeq + 1 + n,
        kind: 'TEXT',
        senderType: 'user',
        senderUserId: sender.id,
        senderLabel: sender.name,
        body: msg.text,
        payload: {},
        status: 'READ',
        createdAt: new Date(now.getTime() - msg.minutesAgo * MINUTE),
      };
    });
    await prisma.chatMessage.createMany({ data: rows, skipDuplicates: true });
    const lastSeq = startSeq + rows.length;
    const last = channel.messages[channel.messages.length - 1];
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastSeq,
        lastMessageAt: new Date(now.getTime() - (last?.minutesAgo ?? 0) * MINUTE),
        lastMessagePreview: last?.text.slice(0, 140) ?? null,
      },
    });
    // Прочитаність: усе прочитано, окрім «хвоста» з `unread` (бейджі в сайдбарі для демо-акаунтів)
    const participants = await prisma.conversationParticipant.findMany({ where: { conversationId, leftAt: null }, select: { userId: true } });
    for (const p of participants) {
      const idx = users.findIndex((u) => u.id === p.userId);
      const unread = channel.unread?.[idx] ?? 0;
      await prisma.conversationParticipant.update({
        where: { conversationId_userId: { conversationId, userId: p.userId } },
        data: { lastReadSeq: lastSeq - unread, unreadCount: unread, lastReadAt: new Date(now.getTime() - 5 * MINUTE) },
      });
    }
    messageCount += rows.length;
  }

  // ── Журнал активності ─────────────────────────────────────────────────────
  const drafts: ActivityDraft[] = [];
  const clamp = (at: Date): Date => new Date(Math.min(at.getTime(), now.getTime() - 30 * MINUTE));

  drafts.push({
    key: 'settings-calendar',
    type: 'settings.updated',
    actorIdx: 0,
    payload: { section: 'calendar' },
    links: [{ entityType: 'tenant', entityId: tenantId, role: 'subject' }],
    at: clamp(new Date(now.getTime() - 30 * DAY)),
  });
  users.forEach((u, i) => {
    drafts.push({
      key: `user-created-${String(i)}`,
      type: 'user.created',
      actorIdx: i === 0 ? null : 0,
      payload: { user: ref('user', u.id, u.name) },
      links: [{ entityType: 'user', entityId: u.id, role: 'subject' }],
      at: clamp(u.createdAt),
    });
  });
  customers.forEach((c, i) => {
    const rng = createRng(`${slug}:activity:${String(i)}`);
    const creator = c.ownerIdx ?? 0;
    const subject = [{ entityType: 'customer', entityId: c.id, role: 'subject' as const }];
    drafts.push({
      key: `customer-created-${String(i)}`,
      type: 'customer.created',
      actorIdx: creator,
      payload: { customer: ref('customer', c.id, c.name) },
      links: subject,
      at: clamp(c.createdAt),
    });
    if (c.ownerIdx !== null && rng.chance(0.18) && activeIdx.length > 1) {
      const previous = activeIdx.find((idx) => idx !== c.ownerIdx) ?? 0;
      const previousUser = users[previous];
      const ownerUser = users[c.ownerIdx];
      if (previousUser && ownerUser) {
        drafts.push({
          key: `customer-owner-${String(i)}`,
          type: 'customer.owner_changed',
          actorIdx: 0,
          payload: {
            customer: ref('customer', c.id, c.name),
            previousOwner: ref('user', previousUser.id, previousUser.name),
            owner: ref('user', ownerUser.id, ownerUser.name),
          },
          links: subject,
          at: clamp(new Date(c.createdAt.getTime() + rng.int(2, 20) * DAY)),
        });
      }
    }
    if (c.status === 'ARCHIVED') {
      drafts.push({
        key: `customer-archived-${String(i)}`,
        type: 'customer.archived',
        actorIdx: creator,
        payload: { customer: ref('customer', c.id, c.name) },
        links: subject,
        at: clamp(c.updatedAt),
      });
    }
  });
  for (const ev of events) {
    const { spec } = ev;
    const customer = ev.customerIdx === undefined ? undefined : customers[ev.customerIdx];
    const links: ActivityDraft['links'] = [{ entityType: 'calendar_event', entityId: ev.id, role: 'subject' }];
    if (customer) links.push({ entityType: 'customer', entityId: customer.id, role: 'context' });
    const eventRef = ref('calendar_event', ev.id, spec.title);
    drafts.push({
      key: `event-created-${spec.key}`,
      type: 'calendar_event.created',
      actorIdx: spec.owner,
      payload: { event: eventRef, startsAt: ev.startsAt.toISOString(), customer: customer ? ref('customer', customer.id, customer.name) : null },
      links,
      at: clamp(ev.createdAt),
    });
    if (spec.rescheduledFromDays) {
      drafts.push({
        key: `event-rescheduled-${spec.key}`,
        type: 'calendar_event.rescheduled',
        actorIdx: spec.owner,
        payload: {
          event: eventRef,
          previousStartsAt: new Date(ev.startsAt.getTime() - spec.rescheduledFromDays * DAY).toISOString(),
          startsAt: ev.startsAt.toISOString(),
        },
        links,
        at: clamp(new Date(ev.createdAt.getTime() + DAY)),
      });
    }
    if (spec.status === 'CANCELLED') {
      drafts.push({
        key: `event-cancelled-${spec.key}`,
        type: 'calendar_event.cancelled',
        actorIdx: spec.owner,
        payload: { event: eventRef },
        links,
        at: clamp(new Date(ev.createdAt.getTime() + DAY)),
      });
    }
    const rsvpRng = createRng(`${slug}:event:${spec.key}:rsvp`);
    for (const a of spec.attendees) {
      const attendee = users[a.user];
      if (!attendee) continue;
      const respondedAt = new Date(ev.createdAt.getTime() + rsvpRng.int(1, 30) * HOUR);
      if (a.response === 'NEEDS_ACTION' || a.user === spec.owner) continue;
      drafts.push({
        key: `event-rsvp-${spec.key}-${String(a.user)}`,
        type: 'calendar_event.rsvp_changed',
        actorIdx: a.user,
        payload: { event: eventRef, attendee: ref('user', attendee.id, attendee.name), response: a.response },
        links,
        at: clamp(respondedAt),
      });
    }
  }

  const activityRows = drafts.map((d) => {
    const actor = actorOf(d.actorIdx);
    return {
      id: uid(slug, 'activity', d.key),
      tenantId,
      type: d.type,
      actorType: actor ? 'user' : 'system',
      actorId: actor?.id ?? null,
      actorLabel: actor?.label ?? null,
      payload: json(ACTIVITY_PAYLOAD_SCHEMAS[d.type].parse(d.payload)),
      createdAt: d.at,
    };
  });
  const addedActivities = await prisma.activity.createMany({ data: activityRows, skipDuplicates: true });
  await prisma.activityLink.createMany({
    data: drafts.flatMap((d) =>
      d.links.map((l) => ({ activityId: uid(slug, 'activity', d.key), tenantId, entityType: l.entityType, entityId: l.entityId, role: l.role })),
    ),
    skipDuplicates: true,
  });

  // ── Сповіщення ────────────────────────────────────────────────────────────
  const notes: NotificationDraft[] = [];
  const upcomingEvents = events.filter((e) => e.startsAt.getTime() > now.getTime() && e.spec.status !== 'CANCELLED');
  activeIdx.forEach((idx) => {
    const u = users[idx];
    if (!u) return;
    notes.push({
      key: 'welcome',
      recipientIdx: idx,
      type: 'user.welcome',
      payload: { tenant: data.name },
      actorIdx: null,
      at: clamp(new Date(u.createdAt.getTime() + MINUTE)),
      read: true,
    });

    // Призначені кастомери: старіші прочитані, найновіший — ні. Для другого демо-акаунта
    // найновіші складаються в згорнутий рядок «призначено N» (groupCount) — як у справжньому інбоксі
    const owned = customers
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.ownerIdx === idx && c.status === 'ACTIVE' && idx !== 0)
      .slice(-4);
    owned.forEach(({ c, i }, n) => {
      const unread = n >= owned.length - 1;
      const grouped = idx === 1 && unread && owned.length > 2;
      notes.push({
        key: `assigned-${String(i)}`,
        recipientIdx: idx,
        type: 'customer.assigned',
        payload: { customer: ref('customer', c.id, c.name) },
        target: { kind: 'customer', id: c.id },
        actorIdx: 0,
        at: clamp(new Date(c.createdAt.getTime() + HOUR)),
        read: !unread,
        ...(grouped && { groupKey: 'customer.assigned', groupCount: 3 }),
      });
    });

    // Запрошення на майбутні події (не організатору)
    upcomingEvents.forEach((ev) => {
      const att = ev.spec.attendees.find((a) => a.user === idx);
      if (!att || ev.spec.owner === idx) return;
      notes.push({
        key: `invited-${ev.spec.key}`,
        recipientIdx: idx,
        type: 'calendar_event.invited',
        payload: { event: ref('calendar_event', ev.id, ev.spec.title), startsAt: ev.startsAt.toISOString(), allDay: ev.spec.allDay ?? false },
        target: { kind: 'calendar_event', id: ev.id },
        actorIdx: ev.spec.owner,
        at: clamp(ev.createdAt),
        read: att.response !== 'NEEDS_ACTION',
      });
    });

    // Організатор бачить відповіді на свої майбутні події
    upcomingEvents.forEach((ev) => {
      if (ev.spec.owner !== idx) return;
      ev.spec.attendees
        .filter((a) => a.response === 'ACCEPTED' || a.response === 'DECLINED')
        .slice(0, 1)
        .forEach((a) => {
          const attendee = users[a.user];
          if (!attendee) return;
          notes.push({
            key: `rsvp-${ev.spec.key}-${String(a.user)}`,
            recipientIdx: idx,
            type: 'calendar_event.rsvp_changed',
            payload: { event: ref('calendar_event', ev.id, ev.spec.title), attendee: ref('user', attendee.id, attendee.name), response: a.response },
            target: { kind: 'calendar_event', id: ev.id },
            actorIdx: a.user,
            at: clamp(new Date(ev.createdAt.getTime() + 6 * HOUR)),
            read: false,
          });
        });
    });
  });
  // Адмін бачить появу найновішого юзера
  const newest = users.length - 1;
  const newestActive = [...activeIdx].reverse().find((i) => i !== 0) ?? newest;
  const newUser = users[newestActive];
  if (newUser) {
    notes.push({
      key: 'user-created',
      recipientIdx: 0,
      type: 'user.created',
      payload: { user: ref('user', newUser.id, newUser.name) },
      target: { kind: 'user', id: newUser.id },
      actorIdx: null,
      at: clamp(new Date(now.getTime() - 3 * HOUR)),
      read: false,
    });
  }

  const noteRows = notes.map((d) => {
    const recipient = users[d.recipientIdx];
    if (!recipient) throw new Error(`Unknown notification recipient ${String(d.recipientIdx)}`);
    const actor = actorOf(d.actorIdx);
    return {
      id: uid(slug, 'notification', d.recipientIdx, d.key),
      tenantId,
      recipientId: recipient.id,
      type: d.type,
      payload: json(NOTIFICATION_PAYLOAD_SCHEMAS[d.type].parse(d.payload)),
      targetKind: d.target?.kind ?? null,
      targetId: d.target?.id ?? null,
      groupKey: d.groupKey ?? null,
      groupCount: d.groupCount ?? 1,
      actorType: actor ? 'user' : 'system',
      actorId: actor?.id ?? null,
      actorLabel: actor?.label ?? null,
      createdAt: d.at,
      updatedAt: d.at,
      readAt: d.read ? new Date(Math.min(d.at.getTime() + 2 * HOUR, now.getTime() - 10 * MINUTE)) : null,
    };
  });
  const addedNotifications = await prisma.notification.createMany({ data: noteRows, skipDuplicates: true });
  // Стан бейджа: демо-акаунти (адмін і другий юзер) лишаємо «не переглянутими» — дзвіночок із цифрою
  for (const idx of activeIdx) {
    const u = users[idx];
    if (!u) continue;
    const seen = idx > 1 ? new Date(now.getTime() - HOUR) : null;
    const count = noteRows.filter((n) => n.recipientId === u.id).length;
    await prisma.notificationState.upsert({
      where: { tenantId_userId: { tenantId, userId: u.id } },
      create: { tenantId, userId: u.id, seenAt: seen, revision: count },
      update: {},
    });
  }

  log(`  ${slug}: ${String(users.length)} users, ${String(events.length)} events, ${String(data.channels.length)} channels (+${String(addedCustomers.count)} customers)`);
  return {
    slug,
    users: users.length,
    events: events.length,
    customers: addedCustomers.count,
    contacts: addedContacts.count,
    messages: messageCount,
    activities: addedActivities.count,
    notifications: addedNotifications.count,
  };
}
