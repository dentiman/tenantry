import type { ChannelAdapter } from './channel-adapter';

export interface ReplyWindow {
  /** Можна написати вільним текстом просто зараз */
  canReply: boolean;
  /** Коли вікно закривається; `null` — вікна немає або клієнт ще не писав */
  endsAt: Date | null;
}

/**
 * Вікно вільного тексту від ЧАСУ ПРОВАЙДЕРА останнього вхідного (CHAT-2b, design.md D3). Для каналу з
 * `windowEnforcement: 'provider'` без жодного відомого вхідного ми нічого не знаємо й не блокуємо (CHAT-3a, D6). Одне
 * правило для API (швидка відмова), воркера (авторитетна перевірка) і відповіді розмови (екран
 * пояснює закрите вікно, а не показує мертве поле).
 */
export function replyWindow(
  adapter: Pick<ChannelAdapter, 'capabilities'> | undefined,
  customerLastMessageAt: Date | null,
  now: Date,
): ReplyWindow {
  const hours = adapter?.capabilities.freeformWindowHours;
  if (hours === undefined) {
    return { canReply: adapter !== undefined, endsAt: null };
  }
  if (!customerLastMessageAt) {
    // Провайдер сам вирішує, поки нема даних про вхідне (CHAT-3a, design.md D6): не блокуємо
    return { canReply: adapter?.capabilities.windowEnforcement === 'provider', endsAt: null };
  }
  const endsAt = new Date(customerLastMessageAt.getTime() + hours * 3_600_000);
  return { canReply: now.getTime() < endsAt.getTime(), endsAt };
}
