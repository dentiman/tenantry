import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@saas-skeleton/ui/components/ui/tooltip';
import { useCopyToClipboard } from '@saas-skeleton/ui/hooks/use-copy-to-clipboard';
import { cn } from '@saas-skeleton/ui/lib/utils';

interface CopyToClipboardProps {
  /** Що потрапляє в буфер. Може відрізнятися від видимого тексту (номер без пробілів) */
  value: string;
  /** Що видно: сам текст або будь-яка розмітка */
  children: ReactNode;
  /** Класи тригера — колір і типографіка належать споживачу, не примітиву */
  className?: string;
  /** Підказка у спокої; дефолт — common:copy.action */
  label?: string;
  /** Підказка після кліку; дефолт — common:copy.copied */
  copiedLabel?: string;
  /** Доступна назва кнопки; дефолт — «Copy <value>» */
  'aria-label'?: string;
}

/**
 * Клікабельне значення, яке копіюється в буфер, і підказка «Copied» на місці.
 *
 * Чому свій компонент, а не пакет із реєстру: у `@shadcn` примітива копіювання
 * немає (перевірено пошуком), а сам механізм — 30 рядків нативного API
 * (`docs/frontend/ui-registry.md`: свій пишемо лише коли реєстр порожній —
 * та сама підстава, що у `FileDropzone`).
 *
 * Чому підказка, а не тост: копіювання — локальна дія над конкретним рядком,
 * і відповідь мусить зʼявитися ТАМ, куди дивиться око. Тости в проєкті вже
 * розібрані двома регіонами (помилки API і живі сповіщення), і третій клас
 * подій у них не додається. Патерн — GitHub/Linear/Stripe: підказка в спокої
 * каже «Copy», після кліку та сама підказка перемикається на «Copied».
 *
 * Тултіп КЕРОВАНИЙ: `open = наведення || скопійовано`. Інакше на клавіатурі
 * (клік по Enter без наведення) підтвердження не показалося б узагалі, а на
 * дотику зникло б разом із наведенням.
 */
export function CopyToClipboard({
  value,
  children,
  className,
  label,
  copiedLabel,
  'aria-label': ariaLabel,
}: CopyToClipboardProps) {
  const { t } = useTranslation('common');
  const { copy, isCopied } = useCopyToClipboard();
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Tooltip open={isHovered || isCopied} onOpenChange={setIsHovered}>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={ariaLabel ?? t('copy.label', { value })}
            className={cn(
              // Підкреслення НЕ ставимо: лінія під значенням читалась би як
              // перехід кудись, а копіювання нікуди не веде. Афорданс дає
              // курсор і зміна кольору, яку задає споживач
              'inline-flex max-w-full cursor-pointer items-center truncate rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
              className,
            )}
            onClick={(event) => {
              // Значення часто живе всередині клікабельного рядка чи картки —
              // копіювання не має заодно відкривати сутність
              event.stopPropagation();
              void copy(value);
            }}
          >
            {children}
          </button>
        }
      />
      <TooltipContent>
        {isCopied ? (
          <>
            <Check aria-hidden className="size-3.5" />
            {copiedLabel ?? t('copy.copied')}
          </>
        ) : (
          (label ?? t('copy.action'))
        )}
      </TooltipContent>
    </Tooltip>
  );
}
