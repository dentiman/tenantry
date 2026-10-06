import type { Prisma } from '@saas-skeleton/database';

/**
 * Дефолтний канал тенанта («General»): розмова, у якій перебувають усі його юзери
 * (docs/chat.md §7.4, design.md D3). Модуль chat; єдина реалізація для трьох місць, де
 * канал народжується або поповнюється: поява тенанта в control plane (хук `tenants`),
 * поява юзера в api (хук `users`) і сід. Раніше кожне писало таблиці чату саме
 * (docs/modules.md §7.3).
 *
 * `tenantId` — явний аргумент, а не tenant-контекст: control plane і сід ідуть під
 * BYPASSRLS-роллю, де DB-default (`current_setting`) дав би NULL. У tenant-транзакції api
 * той самий id просто збігається з контекстом RLS.
 *
 * Чому `private` з повним списком учасників, а не `access = 'tenant'` (design.md D3): «видно
 * всім» вмикало б другу гілку резолвера доступу заради одного рядка і лишало канал БЕЗ
 * рядків учасників — тобто без непрочитаних і без курсора прочитаного рівно там, де їх
 * побачать найпершими.
 */
export const DEFAULT_CHANNEL_TITLE = 'General';

/**
 * Знайти або створити канал тенанта. Ідемпотентно: тримає не назва, а частковий унікальний
 * індекс `(tenant_id) WHERE is_default` — назву колись перейменують, і пошук по 'General'
 * почав би створювати другий канал. Стрічка непорожня з першої секунди: системний запис
 * `conversation.created` (текст не зберігається — type + params, docs/chat.md §4.7).
 */
export async function ensureDefaultChannel(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<{ id: string }> {
  const existing = await tx.conversation.findFirst({
    where: { tenantId, isDefault: true },
    select: { id: true },
  });
  if (existing) {
    return existing;
  }

  const channel = await tx.conversation.create({
    data: {
      tenantId,
      kind: 'INTERNAL',
      access: 'private',
      isDefault: true,
      title: DEFAULT_CHANNEL_TITLE,
      lastSeq: 1,
      lastMessageAt: new Date(),
    },
    select: { id: true },
  });
  await tx.chatMessage.create({
    data: {
      tenantId,
      conversationId: channel.id,
      seq: 1,
      kind: 'SYSTEM',
      senderType: 'system',
      payload: { type: 'conversation.created' },
    },
  });
  return channel;
}

/**
 * Ввести юзера в канал тенанта. Викликається З ТІЄЇ САМОЇ транзакції, що створює юзера:
 * членство — частина його появи, а не окремий крок, який може не статися.
 *
 * Каналу немає — кидаємо. Це зламаний інваріант тенанта (канал створюють поява тенанта,
 * сід і міграційний backfill), і тихо пропустити його означало б назавжди лишити людину
 * поза каналом, не сказавши нікому. Уже учасник — нічого не робимо (ідемпотентно).
 */
export async function joinDefaultChannel(
  tx: Prisma.TransactionClient,
  tenantId: string,
  user: { id: string; name: string | null; email: string },
): Promise<void> {
  const channel = await tx.conversation.findFirst({
    where: { tenantId, isDefault: true },
    select: { id: true },
  });
  if (!channel) {
    throw new Error('Tenant has no default channel — cannot add the user to it');
  }

  const existing = await tx.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId: channel.id, userId: user.id } },
    select: { leftAt: true },
  });
  if (existing?.leftAt === null) {
    return;
  }

  // Інкремент-і-повернення, як у звичайному надсиланні: двох юзерів можуть заводити
  // паралельно, і номер у стрічці має лишитись унікальним
  const { lastSeq } = await tx.conversation.update({
    where: { id: channel.id },
    // Прев'ю не чіпаємо: у системного запису тексту немає (design.md D5)
    data: { lastSeq: { increment: 1 }, lastMessageAt: new Date() },
    select: { lastSeq: true },
  });

  await tx.chatMessage.create({
    data: {
      tenantId,
      conversationId: channel.id,
      seq: lastSeq,
      kind: 'SYSTEM',
      // Відправник — система: людину в дефолтний канал не додають, вона потрапляє в нього
      // за фактом існування
      senderType: 'system',
      payload: {
        type: 'member.added',
        member: { id: user.id, label: user.name ?? user.email },
      },
    },
  });

  await tx.conversationParticipant.upsert({
    where: { conversationId_userId: { conversationId: channel.id, userId: user.id } },
    create: {
      tenantId,
      conversationId: channel.id,
      userId: user.id,
      role: 'member',
      // Приєднання не створює непрочитаних, інакше людина отримала б бейдж «847» з першої
      // секунди і він одразу перестав би щось означати
      joinSeq: lastSeq,
      lastReadSeq: lastSeq,
    },
    update: { leftAt: null, joinSeq: lastSeq, lastReadSeq: lastSeq, unreadCount: 0 },
  });
}
