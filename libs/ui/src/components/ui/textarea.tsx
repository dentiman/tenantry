import * as React from 'react';

import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * ЛОКАЛЬНА ПРАВКА реєстру: горизонтальні відступи `px-3` — та сама метрика,
 * що в однорядкових полів. Мінімальна висота textarea лишається стоковою `min-h-16`.
 * Поверхня використовує semantic `bg-field`, а `border-input` лишається
 * окремою видимою обводкою в обох темах. Зовнішньої тіні немає; focus
 * використовує тонкий `ring-1` у primary blue.
 */
// ЛОКАЛЬНА ПРАВКА реєстру (2026-11-12): фокус — лише `border-ring` (1px, без `ring-1`),
// помилка — лише `border-destructive` (1px, без `ring-2`/60% і без `dark:` послаблення):
// обводка поля міняє колір, а не обростає другим кільцем. Колір фокусу — `--ring`,
// приглушений primary теми (theming.md §1.3.7).
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-field px-3 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
