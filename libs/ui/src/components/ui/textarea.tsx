import * as React from 'react';

import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * ЛОКАЛЬНА ПРАВКА реєстру (2026-08-24, вирівнювання під HeroUI): поле має власну
 * БІЛУ поверхню (`bg-card`) і мʼяку тінь (`shadow-xs`), як `--field-background` +
 * `--field-shadow` у HeroUI. Стокове `bg-transparent` показувало сірий фон
 * сторінки — після переходу на «сіра сторінка / білі панелі» поле губилось.
 * Рамку лишаємо видимою (рішення користувача; у HeroUI вона прозора).
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-card px-2.5 py-2 shadow-xs text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
