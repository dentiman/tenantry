import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@saas-skeleton/ui/components/ui/tooltip';
import { formatDateTime, formatRelativeTime } from '@saas-skeleton/ui/lib/format';

/** Як часто підпис перераховується, щоб «5 minutes ago» само старішало */
const TICK_MS = 30_000;

interface LastSeenProps {
  isOnline: boolean;
  /** Брокер недоступний — про присутність не знаємо нічого */
  isUnknown: boolean;
  /** Уже змержене значення (рядок юзера + socket-дельта): `usePresence().lastSeenAt` */
  lastSeenAt: string | null;
}

/**
 * Підпис присутності: «Online» / «Last seen 5 minutes ago» / «Never».
 *
 * Пара до `PresenceDot`, а не його заміна: крапка малюється ТІЛЬКИ для online
 * і несе сигнал у списку, підпис же розкриває стан словами.
 *
 * `isUnknown` (Valkey недоступна) свідомо НЕ ховає час: `lastSeenAt` приїхав із
 * Postgres і лишається правдою незалежно від брокера. Пропадає лише слово
 * «Online» — його ми справді не знаємо. Деградація виходить кращою за поточну
 * поведінку крапки: замість порожнечі юзер бачить «Last seen 3 minutes ago».
 */
export function LastSeen({ isOnline, isUnknown, lastSeenAt }: LastSeenProps) {
  const { t } = useTranslation('users');
  const [, tick] = useState(0);

  // Перемальовування за таймером потрібне тільки офлайн-підпису: у решті
  // станів текст статичний і будити React немає навіщо
  const isTicking = !isOnline && lastSeenAt !== null;
  useEffect(() => {
    if (!isTicking) {
      return;
    }
    const timer = setInterval(() => {
      tick((n) => n + 1);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [isTicking]);

  if (isOnline && !isUnknown) {
    return <span className="text-success">{t('presence.online')}</span>;
  }
  if (!lastSeenAt) {
    return <span className="text-muted-foreground">{t('presence.never')}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="text-muted-foreground">
            {t('presence.lastSeen', { when: formatRelativeTime(lastSeenAt) })}
          </span>
        }
      />
      {/* Точна дата в тултіпі: відносний час зручний, але «yesterday» іноді
          треба звірити з журналом — тоді потрібна абсолютна позначка */}
      <TooltipContent>{formatDateTime(lastSeenAt)}</TooltipContent>
    </Tooltip>
  );
}
