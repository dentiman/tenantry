import { CHAT_PREVIEW_CHARS } from '../../../contracts/src';
import { Prisma, type PrismaClient } from '../../src/generated/prisma/client';
import { personName } from './people';
import type { DemoTenantDataset } from './types';
import { MINUTE, createRng, uid, type Rng } from './util';

/** Скільки клієнтських розмов кладемо в тенант і скільки з них — з привʼязаним кастомером */
const CONVERSATIONS = 20;
const LINKED = 13;

interface SeedUser {
  id: string;
  name: string;
  active: boolean;
}

interface Participant {
  /** Куди привʼязаний контакт; `null` — людина ще не привʼязана до кастомера */
  customerId: string | null;
  displayName: string | null;
  /** E.164 */
  phone: string;
}

type Flow = 'awaiting' | 'answered-follow-up' | 'answered-read-note' | 'resolved' | 'failed' | 'image' | 'outreach';

interface BuiltConversation {
  drafts: Draft[];
  /** Час провайдера останнього вхідного — від нього рахується вікно */
  lastInboundAt: Date | null;
  /** Час останнього публічного повідомлення (`last_message_at`) */
  lastAt: Date;
  lastBody: string;
  /** Скільки вхідних після останньої відповіді агента — непрочитане для відповідального */
  unread: number;
}

/** Рядок вхідного/вихідного повідомлення до вставки (без `seq` — його видає порядок у розмові) */
type Draft = Omit<Prisma.ChatMessageCreateManyInput, 'seq' | 'conversationId' | 'tenantId' | 'id'>;

const preview = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > CHAT_PREVIEW_CHARS ? `${flat.slice(0, CHAT_PREVIEW_CHARS - 1)}…` : flat;
};

/** Крива сценаріїв: на що схожа кожна розмова, щоб скринька показувала всі стани, а не двадцять однакових */
function flowOf(k: number): Flow {
  if (k === 5) return 'image';
  if (k === 11) return 'outreach';
  return (['awaiting', 'answered-follow-up', 'answered-read-note', 'resolved', 'failed'] as const)[k % 5] ?? 'awaiting';
}

/**
 * Fake-WhatsApp і розмови з клієнтами для демо-тенанта (docs/demo.md): акаунт і канал провайдера
 * `fake`, ~20 клієнтських розмов — частина привʼязана до кастомерів тенанта, частина від людей без
 * кастомера, у різних станах (чекає відповіді, у роботі, очікування, закрита, помилка доставки,
 * заглушка вкладення, розмова, яку почав агент шаблоном).
 *
 * Пишеться напряму в таблиці (як решта демо-сіду, під BYPASSRLS), але форма рядків та сама, що в
 * `ChannelIngestService`/`CustomerChatService`/`ConversationWorkflow` — інакше екран показував би
 * те, чого справжній шлях ніколи не створює. Ідемпотентно за наявністю fake-акаунта тенанта: на
 * повторному запуску нічого не додається. Повертає кількість доданих повідомлень.
 */
export async function seedCustomerChat(
  prisma: PrismaClient,
  args: { tenantId: string; data: DemoTenantDataset; users: SeedUser[]; activeIdx: number[]; now: Date },
): Promise<number> {
  const { tenantId, data, users, activeIdx, now } = args;
  const slug = data.slug;

  const existing = await prisma.messagingAccount.findFirst({ where: { tenantId, provider: 'fake' }, select: { id: true } });
  if (existing) return 0;

  const rng = createRng(`${slug}:customer-chat`);
  const agents = activeIdx.flatMap((idx) => (users[idx] ? [users[idx]] : []));
  if (agents.length === 0) return 0;

  // ── Акаунт і канал ───────────────────────────────────────────────────────
  const accountId = uid(slug, 'fake-account');
  const channelId = uid(slug, 'fake-channel');
  const hex = (key: string): string => uid(slug, key).replace(/-/g, '');
  await prisma.messagingAccount.create({
    data: {
      id: accountId,
      tenantId,
      provider: 'fake',
      name: 'Fake WhatsApp (demo)',
      // Секрет підпису не задано: вебхука цього акаунта ніхто не викликає, а dev-інструмент
      // `fake-channel` (CHAT_DEV_TOOLS) його довипускає за потреби
      verifyToken: hex('fake-verify'),
      webhookKey: hex('fake-webhook'),
      status: 'CONNECTED',
    },
  });
  await prisma.channel.create({
    data: {
      id: channelId,
      tenantId,
      accountId,
      type: 'WHATSAPP',
      provider: 'fake',
      // Унікальний між тенантами (часткове UNIQUE provider+external_id), тому з slug
      externalId: `fake-demo-${slug}`,
      displayPhoneNumber: `+1 555 010 ${String(rng.int(1000, 9999))}`,
      verifiedName: `${data.name} (fake)`,
      isEnabled: true,
      isDefault: true,
      syncedAt: now,
    },
  });

  // ── Люди по той бік каналу ───────────────────────────────────────────────
  const customers = await prisma.customer.findMany({
    where: { tenantId, externalId: { startsWith: `demo-${slug}-` }, status: 'ACTIVE', phone: { not: null } },
    orderBy: { number: 'asc' },
    select: { id: true, name: true, kind: true, phone: true, country: true, contacts: { where: { isPrimary: true }, select: { name: true }, take: 1 } },
  });
  const taken = new Set<string>();
  const people: Participant[] = [];
  // Привʼязані розмови: переважно організації (кожна друга з придатних, щоб вони були розкидані по списку),
  // але щотретя — кастомер-особа, щоб у скриньці видно обидві форми аватара (квадрат із будівлею й коло)
  const orgs = customers.filter((c) => c.kind === 'ORGANIZATION').filter((_, i) => i % 2 === 0);
  const persons = customers.filter((c) => c.kind === 'PERSON');
  while (people.length < LINKED && (orgs.length > 0 || persons.length > 0)) {
    const wantPerson = people.length % 3 === 2 && persons.length > 0;
    const c = (wantPerson ? persons : orgs.length > 0 ? orgs : persons).shift();
    if (!c?.phone || taken.has(c.phone)) continue;
    taken.add(c.phone);
    people.push({
      customerId: c.id,
      // Пише людина, а не компанія: для організації береться її основний контакт, для особи — вона сама
      displayName: c.kind === 'ORGANIZATION' ? (c.contacts[0]?.name ?? c.name) : c.name,
      phone: c.phone,
    });
  }
  const countries = [...new Set([...data.orgs, ...data.persons].map((x) => x.country))];
  const customerPhones = new Set(customers.map((c) => c.phone));
  while (people.length < CONVERSATIONS) {
    const country = rng.pick(countries);
    const name = personName(country, rng);
    // Вигаданий номер у зарезервованому для прикладів діапазоні, що не збігається з жодним кастомером
    const phone = `+1555010${String(rng.int(1000, 9999))}`;
    if (taken.has(phone) || customerPhones.has(phone)) continue;
    taken.add(phone);
    people.push({
      customerId: null,
      // Кожна шоста людина не вказала імені у профілі — лишається «Unknown contact»
      displayName: people.length % 6 === 5 ? null : `${name.first} ${name.last}`,
      phone,
    });
  }

  // ── Розмови ──────────────────────────────────────────────────────────────
  let messageCount = 0;
  const spec = data.customerChat;
  const at = (minutesAgo: number): Date => new Date(now.getTime() - minutesAgo * MINUTE);

  for (let k = 0; k < people.length; k += 1) {
    const person = people[k];
    if (!person) continue;
    const flow = flowOf(k);
    const r = createRng(`${slug}:customer-chat:${String(k)}`);
    const agent = agents[k % agents.length] ?? agents[0];
    if (!agent) continue;

    const contactId = uid(slug, 'fake-contact', k);
    const conversationId = uid(slug, 'fake-conversation', k);
    const digits = person.phone.replace(/\D/g, '');
    const label = person.displayName ?? `+${digits}`;

    // Перші розмови — «щойно», решта розкидана на кілька днів назад
    const start = k < 3 ? 12 + k * 25 : 90 + (k - 3) * 330 + r.int(0, 90);
    const built = buildDrafts({ flow, spec, r, k, start, label, agent, contactId, channelId, slug, at });
    const status = statusOf(flow, k);
    const assigned = flow !== 'awaiting' && flow !== 'image';

    await prisma.channelContact.create({
      data: {
        id: contactId,
        tenantId,
        channelId,
        displayName: person.displayName,
        customerId: person.customerId,
        lastInboundAt: built.lastInboundAt,
        createdAt: at(start),
      },
    });
    await prisma.channelContactAddress.create({
      data: { tenantId, contactId, channelId, kind: 'phone', value: digits, normalized: person.phone, createdAt: at(start) },
    });
    await prisma.conversation.create({
      data: {
        id: conversationId,
        tenantId,
        kind: 'CUSTOMER',
        access: 'tenant',
        status,
        channelId,
        contactId,
        customerLastMessageAt: built.lastInboundAt,
        assigneeId: assigned ? agent.id : null,
        resolvedAt: status === 'RESOLVED' ? built.lastAt : null,
        lastSeq: built.drafts.length,
        lastMessageAt: built.lastAt,
        lastMessagePreview: preview(built.lastBody),
        createdAt: at(start),
        updatedAt: built.lastAt,
      },
    });
    await prisma.chatMessage.createMany({
      data: built.drafts.map((draft, n) => ({ ...draft, id: uid(slug, 'fake-message', k, n), tenantId, conversationId, seq: n + 1 })),
    });
    messageCount += built.drafts.length;

    if (assigned) {
      // Відповідальний — учасник; непрочитане рахується лише йому (ChannelIngestService)
      await prisma.conversationParticipant.create({
        data: {
          conversationId,
          tenantId,
          userId: agent.id,
          role: 'member',
          joinSeq: 0,
          lastReadSeq: built.drafts.length - built.unread,
          unreadCount: built.unread,
          lastReadAt: at(5),
          joinedAt: at(start),
        },
      });
    }
  }
  return messageCount;
}

function statusOf(flow: Flow, k: number): 'OPEN' | 'PENDING' | 'RESOLVED' {
  if (flow === 'resolved') return 'RESOLVED';
  if (flow === 'answered-read-note' && k % 2 === 1) return 'PENDING';
  return 'OPEN';
}

function buildDrafts(args: {
  flow: Flow;
  spec: DemoTenantDataset['customerChat'];
  r: Rng;
  k: number;
  start: number;
  label: string;
  agent: SeedUser;
  contactId: string;
  channelId: string;
  slug: string;
  at: (minutesAgo: number) => Date;
}): BuiltConversation {
  const { flow, spec, r, k, start, label, agent, contactId, channelId, slug, at } = args;
  const out: Draft[] = [];
  let n = 0;
  let lastInboundAt: Date | null = null;
  let lastAt = at(start);
  let lastBody = '';
  let unread = 0;

  const inbound = (minutesAgo: number, body: string, payload?: Prisma.InputJsonObject): void => {
    const when = at(minutesAgo);
    out.push({
      kind: 'TEXT',
      visibility: 'PUBLIC',
      status: 'SENT',
      senderType: 'customer',
      senderLabel: label,
      body,
      payload: payload ?? {},
      direction: 'INBOUND',
      channelId,
      externalId: `fake-in-${slug}-${String(k)}-${String(n)}`,
      senderContactId: contactId,
      providerSentAt: when,
      providerMeta: { simulated: true },
      createdAt: when,
    });
    n += 1;
    lastInboundAt = when;
    lastAt = when;
    lastBody = body;
    unread += 1;
  };
  const outbound = (
    minutesAgo: number,
    body: string,
    status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED',
    extra: { template?: { name: string; language: string } } = {},
  ): void => {
    const when = at(minutesAgo);
    const sentAt = when;
    const deliveredAt = status === 'DELIVERED' || status === 'READ' ? at(minutesAgo - 1) : null;
    const readAt = status === 'READ' ? at(minutesAgo - 3) : null;
    out.push({
      kind: 'TEXT',
      visibility: 'PUBLIC',
      status,
      senderType: 'user',
      senderUserId: agent.id,
      senderLabel: agent.name,
      body,
      payload: extra.template ? { template: extra.template } : {},
      direction: 'OUTBOUND',
      channelId,
      externalId: status === 'FAILED' ? null : `fake-out-${slug}-${String(k)}-${String(n)}`,
      attempts: 1,
      sentAt: status === 'FAILED' ? null : sentAt,
      deliveredAt,
      readAt,
      ...(status === 'FAILED' && {
        failure: { class: 'PERMANENT', code: '131026', title: 'Recipient cannot receive this message' },
      }),
      providerMeta: { simulated: true },
      createdAt: when,
    });
    n += 1;
    lastAt = when;
    lastBody = body;
    unread = 0;
  };
  const note = (minutesAgo: number, body: string): void => {
    out.push({
      kind: 'TEXT',
      visibility: 'INTERNAL',
      status: 'SENT',
      senderType: 'user',
      senderUserId: agent.id,
      senderLabel: agent.name,
      body,
      payload: {},
      createdAt: at(minutesAgo),
    });
    n += 1;
  };
  const system = (minutesAgo: number, payload: Prisma.InputJsonObject): void => {
    out.push({
      kind: 'SYSTEM',
      visibility: 'INTERNAL',
      status: 'SENT',
      senderType: 'user',
      senderUserId: agent.id,
      senderLabel: agent.name,
      payload,
      createdAt: at(minutesAgo),
    });
    n += 1;
  };

  const question = r.pick(spec.questions).replace('{ref}', String(r.int(41000, 49999)));
  const reply = r.pick(spec.replies);
  const followUp = r.pick(spec.followUps);
  const assignedEntry = { type: 'conversation.assigned', assignee: { id: agent.id, label: agent.name } };

  switch (flow) {
    case 'awaiting':
      inbound(start, question);
      break;
    case 'image':
      inbound(start, '[image]', { unsupported: { type: 'image' } });
      break;
    case 'outreach':
      // Розмову почав агент шаблоном: клієнт ще не писав
      system(start, assignedEntry);
      outbound(start - 1, 'order_update', 'DELIVERED', { template: { name: 'order_update', language: 'en_US' } });
      break;
    case 'answered-follow-up':
      inbound(start, question);
      system(start - 4, assignedEntry);
      outbound(start - 6, reply, 'DELIVERED');
      inbound(Math.max(start - 40, 2), followUp);
      break;
    case 'answered-read-note':
      inbound(start, question);
      system(start - 4, assignedEntry);
      outbound(start - 6, reply, 'READ');
      note(start - 9, r.pick(spec.notes));
      if (k % 2 === 1) system(start - 10, { type: 'conversation.status_changed', from: 'OPEN', to: 'PENDING' });
      break;
    case 'resolved':
      inbound(start, question);
      system(start - 4, assignedEntry);
      outbound(start - 6, reply, 'READ');
      inbound(Math.max(start - 30, 2), followUp);
      system(Math.max(start - 35, 1), { type: 'conversation.status_changed', from: 'OPEN', to: 'RESOLVED' });
      break;
    case 'failed':
      inbound(start, question);
      system(start - 4, assignedEntry);
      outbound(start - 6, reply, 'FAILED');
      break;
  }
  return { drafts: out, lastInboundAt, lastAt, lastBody, unread };
}
