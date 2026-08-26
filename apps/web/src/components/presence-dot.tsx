import { AvatarBadge } from '@saas-skeleton/ui/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@saas-skeleton/ui/components/ui/tooltip';

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
