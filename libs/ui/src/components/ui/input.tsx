import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';

import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * ЛОКАЛЬНА ПРАВКА реєстру:
 *   1. висота 36px (`h-9`) і відступи `px-3` — наша метрика, щоб поля й кнопки
 *      стояли в один рядок;
 *   2. автозаповнення браузера більше не фарбує поле блідо-жовтим: нескінченний
 *      transition на background-color + `-webkit-text-fill-color` (прийом узятий
 *      з input coss ui). У темній темі стокове поле після autofill виглядало
 *      зламаним;
 *   3. у `type="search"` прибрано нативний ✕ WebKit — він не з нашої системи
 *      (там само).
 *   4. поверхня використовує semantic `bg-field`, а `border-input` лишається
 *      окремою видимою обводкою в обох темах.
 *   5. зовнішньої тіні немає; focus — 1px `border-ring` (приглушений primary теми), без кільця.
 *   6. `size="sm"` — opt-in висота 32px для компактних toolbar-ів; дефолтні поля
 *      форм лишаються 36px.
 */
// ЛОКАЛЬНА ПРАВКА реєстру (2026-11-12): фокус — лише `border-ring` (1px, без `ring-1`),
// помилка — лише `border-destructive` (1px, без `ring-2`/60% і без `dark:` послаблення):
// обводка поля міняє колір, а не обростає другим кільцем. Колір фокусу — `--ring`,
// приглушений primary теми (theming.md §1.3.7).
function Input({
  className,
  type,
  size = 'default',
  ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & {
  size?: 'sm' | 'default';
}) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(
        'w-full min-w-0 rounded-lg border border-input bg-field px-3 py-1 text-base [transition:background-color_5000000s_ease-in-out_0s,border-color_150ms_ease,box-shadow_150ms_ease] autofill:[-webkit-text-fill-color:var(--foreground)] data-[size=default]:h-9 data-[size=sm]:h-8 data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-[size=sm]:px-2.5 data-[size=sm]:text-sm [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
