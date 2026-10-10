/** Те, що потрібно i18next, щоб скласти підпис «хто друкує» */
export interface TypingLabel {
  key: 'typing.one' | 'typing.two' | 'typing.many';
  values: Record<string, string | number>;
}

interface NamedParticipant {
  id: string;
  name: string | null;
  email: string;
}

/**
 * Підпис індикатора набору: одне імʼя, два імені або «N людей». Чистий — щоб правило
 * («не нанизувати по рядку на людину») перевірялось тестом без DOM.
 *
 * Імʼя береться з картки розмови (`name ?? email`), а не з події: подія несе лише `userId`,
 * бо учасників клієнт уже знає. Невідомий id (учасника щойно додали, а картка ще не
 * перечитана) пропускається, а не показується голим uuid.
 */
export function describeTypists(
  typistIds: readonly string[],
  participants: readonly NamedParticipant[],
): TypingLabel | null {
  const names = typistIds.flatMap((id) => {
    const participant = participants.find((candidate) => candidate.id === id);
    return participant ? [participant.name ?? participant.email] : [];
  });

  if (names.length === 0) {
    return null;
  }
  if (names.length === 1) {
    return { key: 'typing.one', values: { name: names[0] ?? '' } };
  }
  if (names.length === 2) {
    return { key: 'typing.two', values: { first: names[0] ?? '', second: names[1] ?? '' } };
  }
  return { key: 'typing.many', values: { count: names.length } };
}
