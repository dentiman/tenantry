import { Button } from '@saas-skeleton/ui/components/ui/button';
import { useTranslation } from 'react-i18next';
import { DEMO_PLATFORM_ACCOUNT } from '@saas-skeleton/contracts/demo';

/**
 * Демо-вхід консолі — той самий патерн, що в tenant-порталі
 * (`apps/web/src/features/auth/components/demo-accounts.tsx`), з єдиним
 * оператором. Вимикач — `VITE_DEMO_LOGINS=false` на збірці.
 */
export const DEMO_LOGINS_ENABLED = import.meta.env.VITE_DEMO_LOGINS !== 'false';

export const DEFAULT_DEMO_OPERATOR = DEMO_LOGINS_ENABLED ? DEMO_PLATFORM_ACCOUNT : undefined;

/** Клік заповнює форму оператором і викликає ту саму `onSubmit`, що й кнопка Sign in */
export function DemoOperator({ disabled, onSelect }: { disabled: boolean; onSelect: () => void }) {
  const { t } = useTranslation('auth');

  return (
    <section aria-labelledby="demo-accounts-title" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <h2 id="demo-accounts-title" className="text-xs font-medium text-muted-foreground">
          {t('demo.title')}
        </h2>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={disabled}
          title={DEMO_PLATFORM_ACCOUNT.email}
          onClick={onSelect}
        >
          {t('demo.chip', { role: t('demo.operator'), name: DEMO_PLATFORM_ACCOUNT.name })}
        </Button>
      </div>
    </section>
  );
}
