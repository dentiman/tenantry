import { useTranslation } from 'react-i18next';
import { AvatarBadge } from '@saas-skeleton/ui/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@saas-skeleton/ui/components/ui/tooltip';
import { usePresence } from '../realtime/use-presence';

interface PresenceDotProps {
  isOnline: boolean;
  /** Брокер недоступний — стан присутності невідомий */
  isUnknown: boolean;
  /** Підпис індикатора; показується тултіпом (стан «offline» не малюється взагалі) */
  label: string;
}

/**
 * Індикатор присутності поверх аватара. Малюється ТІЛЬКИ для юзера онлайн:
 * «offline» — це стан за замовчуванням у списку, і крапка на кожному другому
 * рядку перетворювала б сигнал на шум. При `isUnknown` (брокер недоступний)
 * теж нічого: сірий кружечок читався б як «offline», тобто застосунок
 * стверджував би те, чого не знає.
 *
 * Позиціювання і обвід дає `AvatarBadge` реєстру (він же бере розмір від `Avatar`),
 * підпис — справжній `Tooltip` замість атрибута `title`, який не показується з
 * клавіатури (замінений абсолютний span — docs/frontend/ui-migration-history.md §4).
 */
export function PresenceDot({ isOnline, isUnknown, label }: PresenceDotProps) {
  if (isUnknown || !isOnline) {
    return null;
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={<AvatarBadge role="img" aria-label={label} className="bg-success" />}
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Та сама крапка, але **підключена**: бере присутність сама і не вимагає нічого,
 * крім id юзера.
 *
 * Заведена, коли присутність із демо в `/users` стала властивістю КОЖНОГО місця,
 * де застосунок малює людину (F-18 і далі): змушувати кожного споживача
 * прокидати `usePresence()` означало б, що список гостей її показує, а точнісінько
 * такий самий список у пісочниці — ні, і різниця залежала б від того, чи згадав
 * автор сторінки про realtime.
 *
 * Хук викликається на КОЖЕН значок, і це свідомо: снапшот присутності — один
 * запит із `staleTime: Infinity` на весь застосунок, тож N значків дають N
 * спостерігачів одного кеша, а не N запитів. Ціна — перемальовування рівно тих
 * рядків, які й мусять перемалюватись на дельту.
 */
export function UserPresenceBadge({ userId }: { userId: string }) {
  const presence = usePresence();
  const { t } = useTranslation('common');
  return (
    <PresenceDot
      isOnline={presence.isOnline(userId)}
      isUnknown={presence.isUnknown}
      label={t('presence.online')}
    />
  );
}
