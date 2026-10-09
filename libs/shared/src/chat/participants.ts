import type { Prisma } from '@saas-skeleton/database';

/**
 * Ідентифікатори АКТИВНИХ учасників розмови (`left_at IS NULL`) — рівно та множина, яку
 * пускає єдина функція доступу чату. Читається З ТІЄЇ САМОЇ транзакції, що пише зміну:
 * вставка репліки і вступ юзера беруть рядок розмови в замок інкрементом `last_seq`, тож
 * склад учасників тут відповідає стрічці, до якої належить запис (docs/chat.md §4.8,
 * design.md D1). Читання ДО транзакції загубило б того, кого додали паралельно, і
 * показало б репліку тому, кого паралельно прибрали.
 *
 * Живе в `libs/shared`, а не в api: у CHAT-2 той самий список знадобиться воркеру, що
 * змінює статуси доставки.
 */
export async function activeParticipantIds(
  tx: Prisma.TransactionClient,
  conversationId: string,
): Promise<string[]> {
  const rows = await tx.conversationParticipant.findMany({
    where: { conversationId, leftAt: null },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
}
