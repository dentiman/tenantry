import { AvatarBadge } from '@saas-skeleton/ui/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@saas-skeleton/ui/components/ui/tooltip';

interface PresenceDotProps {
  isOnline: boolean;
  /** Брокер недоступний — стан присутності невідомий */
  isUnknown: boolean;
  labels: { online: string; offline: string };
}

/**
 * Індикатор присутності поверх аватара. При `isUnknown` не рендериться взагалі — і це
 * головне рішення компонента: сірий кружечок читався б як «offline», тобто застосунок
 * стверджував би те, чого не знає. Відсутність індикатора чесніша.
 *
 * Позиціювання і обвід дає `AvatarBadge` реєстру (він же бере розмір від `Avatar`),
 * підпис — справжній `Tooltip` замість атрибута `title`, який не показується з
 * клавіатури (UI-1, костиль 8 у docs/migrate-web.md §3.2).
 */
export function PresenceDot({ isOnline, isUnknown, labels }: PresenceDotProps) {
  if (isUnknown) {
    return null;
  }
  const label = isOnline ? labels.online : labels.offline;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <AvatarBadge
            role="img"
            aria-label={label}
            // bg-muted у shadcn — світлий ФОН, а не сірий текст: для offline-крапки
            // потрібен контрастний нейтральний, інакше вона зникає на аватарі
            className={isOnline ? 'bg-success' : 'bg-muted-foreground/50'}
          />
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
