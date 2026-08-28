import * as React from 'react';

import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * ЛОКАЛЬНА ПРАВКА реєстру: горизонтальні відступи `px-3` — та сама метрика,
 * що в однорядкових полів. Мінімальна висота textarea лишається стоковою `min-h-16`.
 * Поверхня використовує semantic `bg-field`, а `border-input` лишається
 * окремою видимою обводкою в обох темах. Зовнішньої тіні немає; focus
 * використовує тонкий `ring-1` у primary blue.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-field px-3 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/60 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/60',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
