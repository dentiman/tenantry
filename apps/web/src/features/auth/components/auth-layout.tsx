import type { ReactNode } from 'react';
import { Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AuthShell } from '@saas-skeleton/ui/components/auth-shell';

/**
 * `AuthShell` зі знаком і назвою tenant-порталу — той самий `Layers` і той самий
 * рядок `layout:brand`, що в якорі рейлу (`app-shell/app-rail.tsx`), щоб вхід і
 * застосунок читались одним продуктом.
 *
 * `footerLink` — тихе посилання в футері після копірайту (зараз лише сторінка входу
 * веде в публічний путівник): сторінки відновлення пароля й підтвердження email
 * відкривають із листа, посилання на «про систему» там було б шумом.
 */
export function AuthLayout({
  title,
  footerLink,
  children,
}: {
  title: string;
  footerLink?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation(['layout', 'auth']);
  const productName = t('layout:brand');
  const copyright = t('auth:shell.footer', {
    year: new Date().getFullYear(),
    product: productName,
  });

  return (
    <AuthShell
      logo={<Layers />}
      productName={productName}
      title={title}
      footer={
        footerLink ? (
          <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span>{copyright}</span>
            {footerLink}
          </span>
        ) : (
          copyright
        )
      }
    >
      {children}
    </AuthShell>
  );
}
