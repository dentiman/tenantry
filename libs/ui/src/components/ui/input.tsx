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
 * Поверхня і тінь — стокові реєстрові (тема shadcn-admin: біла сторінка).
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-1 text-base shadow-xs [transition:background-color_5000000s_ease-in-out_0s,border-color_150ms_ease,box-shadow_150ms_ease] autofill:[-webkit-text-fill-color:var(--foreground)] [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none dark:bg-input/30 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/60 md:text-sm dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/60',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
