import type { ReactNode } from 'react';
import { BrandBackdrop } from '@saas-skeleton/ui/components/brand-backdrop';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@saas-skeleton/ui/components/ui/card';

interface AuthShellProps {
  /** Знак продукту — та сама піктограма, що в якорі рейлу застосунку */
  logo: ReactNode;
  productName: string;
  title: string;
  description?: ReactNode;
  /** Тихий рядок під карткою (копірайт тощо) */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Обгортка всіх сторінок без сесії (вхід, відновлення пароля, підтвердження
 * email) обох фронтів: брендовий фон на все вікно, по центру скляна картка.
 *
 * Не знає ні роутера, ні i18n — застосунок передає готові знак, назву й тексти.
 *
 * Скло — не окремі кольори, а той самий токен-патерн, що й шел `/guide`
 * (docs/frontend/brand-backdrop.md §4.2): корінь ставить `data-backdrop="brand"`,
 * і `--card` під ним сам стає `--card-glass`. Рамку, блюр і світіння картки дає
 * `data-slot="auth-card"` (`brand-backdrop.css` §3). Фон — варіант `auth`: одна
 * аура за карткою, без точок.
 */
export function AuthShell({
  logo,
  productName,
  title,
  description,
  footer,
  children,
}: AuthShellProps) {
  return (
    <div
      data-backdrop="brand"
      className="flex min-h-svh flex-col items-center px-4 py-10 text-foreground"
    >
      <BrandBackdrop variant="auth" />

      {/* `relative` — щоб вміст малювався над фіксованим шаром фону (той без z-index) */}
      <main className="relative flex w-full flex-1 flex-col items-center justify-center gap-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground [&_svg]:size-5">
            {logo}
          </div>
          <span className="text-base font-semibold tracking-tight">{productName}</span>
        </div>

        <Card data-slot="auth-card" className="w-full max-w-md [--card-spacing:--spacing(6)]">
          <CardHeader>
            <CardTitle className="text-center text-xl">{title}</CardTitle>
            {description && (
              <CardDescription className="text-center">{description}</CardDescription>
            )}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </main>

      {footer && <footer className="relative mt-8 text-xs text-muted-foreground">{footer}</footer>}
    </div>
  );
}
