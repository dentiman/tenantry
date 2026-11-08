import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Card, CardContent } from '@saas-skeleton/ui/components/ui/card';
import { useTranslation } from 'react-i18next';
import { DEMO_ACCOUNTS, type DemoAccount } from '@saas-skeleton/contracts/demo';

/**
 * Демо-вхід (docs/demo.md): префіл форми й чипи акаунтів. Вимикач без правки
 * коду — `VITE_DEMO_LOGINS=false` на збірці; будь-яке інше значення або його
 * відсутність лишають демо-вхід увімкненим.
 */
export const DEMO_LOGINS_ENABLED = import.meta.env.VITE_DEMO_LOGINS !== 'false';

/** Флагманський акаунт — перший у списку, ним префілиться форма */
export const DEFAULT_DEMO_ACCOUNT: DemoAccount | undefined = DEMO_LOGINS_ENABLED
  ? DEMO_ACCOUNTS[0]
  : undefined;

/** Порядок груп і акаунтів — як у `DEMO_ACCOUNTS` */
function groupByTenant(accounts: readonly DemoAccount[]) {
  const groups = new Map<string, { tenantName: string; accounts: DemoAccount[] }>();
  for (const account of accounts) {
    const group = groups.get(account.tenant);
    if (group) {
      group.accounts.push(account);
    } else {
      groups.set(account.tenant, { tenantName: account.tenantName, accounts: [account] });
    }
  }
  return [...groups.entries()];
}

/**
 * Клік по чипу не має власного шляху входу: сторінка заповнює форму цим
 * акаунтом і викликає ту саму `onSubmit`, що й кнопка Sign in.
 */
export function DemoAccounts({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (account: DemoAccount) => void;
}) {
  const { t } = useTranslation('auth');

  // Лише галузеві демо-тенанти (по два акаунти); базовий `default` — робочий акаунт
  // розробника, на екрані входу йому місця немає
  const groups = groupByTenant(DEMO_ACCOUNTS).filter(([tenant]) => tenant !== 'default');

  return (
    <section aria-labelledby="demo-accounts-title" className="flex flex-col gap-5">
      <h2
        id="demo-accounts-title"
        className="text-center text-xs font-medium text-muted-foreground"
      >
        {t('demo.title')}
      </h2>
      <div className="grid grid-cols-1 gap-x-3 gap-y-6 sm:grid-cols-3">
        {groups.map(([tenant, group]) => (
          // Назва тенанта — плашка-«кнопка» на верхній межі картки, по центру межі
          // по вертикалі. Лежить поза `Card` (той `overflow-hidden` її б обрізав)
          <div key={tenant} className="relative">
            <span className="absolute top-0 left-3 z-10 -translate-y-1/2 rounded-full border border-primary/30 bg-[color-mix(in_oklab,var(--primary)_16%,white)] px-2.5 py-0.5 text-xs font-medium text-foreground dark:bg-[color-mix(in_oklab,var(--primary)_40%,black)]">
              {group.tenantName}
            </span>
            <Card fill="muted" size="sm" className="h-full">
              <CardContent className="flex flex-col gap-1.5 pt-1">
                {group.accounts.map((account) => (
                  <Button
                    key={account.email}
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={disabled}
                    title={account.email}
                    onClick={() => {
                      onSelect(account);
                    }}
                  >
                    {t('demo.chip', { role: account.roleLabel, name: account.name })}
                  </Button>
                ))}
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </section>
  );
}
