import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AuthShell } from '@saas-skeleton/ui/components/auth-shell';

/**
 * `AuthShell` зі знаком і назвою консолі — той самий `ShieldCheck` і рядок
 * `layout:brand`, що в якорі рейлу (`app-shell/app-rail.tsx`).
 */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation(['layout', 'auth']);
  const productName = t('layout:brand');

  return (
    <AuthShell
      logo={<ShieldCheck />}
      productName={productName}
      title={title}
      footer={t('auth:shell.footer', { year: new Date().getFullYear(), product: productName })}
    >
      {children}
    </AuthShell>
  );
}
