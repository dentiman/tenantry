import type { TFunction } from 'i18next';
import { formatTime } from '@saas-skeleton/ui/lib/format';
import type { ChatMessage, Conversation } from './use-chat';

/**
 * Підпис розмови. Назва, якщо її задали; інакше — імена співрозмовників, бо
 * «Untitled» у списку не відрізняє одну розмову від іншої.
 */
export function conversationLabel(
  conversation: Conversation,
  viewerId: string,
  t: TFunction<'chat'>,
): string {
  if (conversation.title) {
    return conversation.title;
  }
  // Клієнтська розмова: людина по той бік каналу, а не «Just you» (учасників у ній нема)
  if (conversation.contact) {
    return (
      conversation.contact.displayName ??
      conversation.contact.channelNumber ??
      t('inbox.unknownContact')
    );
  }
  const others = conversation.participants.filter((p) => p.id !== viewerId);
  if (others.length === 0) {
    return t('conversation.justYou');
  }
  return others.map((p) => p.name ?? p.email).join(', ');
}

/**
 * Час у рядку СПИСКУ розмов — компактний: `10:12` сьогодні, `Mon` цього тижня,
 * далі дата.
 *
 * Не `formatRelativeTime`: «1 minute ago» — це 12 символів у колонці шириною з
 * бічну панель, і назва розмови починала обрізатись («Genera…»). У самій
 * стрічці час лишається повним — там місця досить.
 */
export function compactTime(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return formatTime(iso);
  }
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  if (days < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
}

/** Ініціали для аватара-фолбека */
export function initialsOf(value: string): string {
  const parts = value.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?';
}

/**
 * Текст системного запису. Бекенд зберігає `type` + параметри і НЕ зберігає
 * тексту (docs/chat.md §4.7) — рендер тут, мовою читача.
 *
 * Невідомий тип не ламає стрічку: у неї міг потрапити запис, доданий новішою
 * версією сервера, і порожній рядок краще за викид.
 */
export function systemEntryText(message: ChatMessage, t: TFunction<'chat'>): string {
  const payload = message.payload as { type?: string; member?: { label?: string } };
  const actor = message.senderLabel ?? t('system.actorSystem');

  switch (payload.type) {
    case 'conversation.created':
      return t('system.conversationCreated', { actor });
    case 'member.added':
      return t('system.memberAdded', { actor, member: payload.member?.label ?? '' });
    default:
      return '';
  }
}
