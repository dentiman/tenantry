import { Button } from '@saas-skeleton/ui/components/ui/button';
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

  return (
    <section aria-labelledby="demo-accounts-title" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <h2 id="demo-accounts-title" className="text-xs font-medium text-muted-foreground">
          {t('demo.title')}
        </h2>
        <div className="h-px flex-1 bg-border" />
      </div>
      {groupByTenant(DEMO_ACCOUNTS).map(([tenant, group]) => (
        <div key={tenant} className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">{group.tenantName}</span>
          <div className="flex flex-wrap gap-1.5">
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
          </div>
        </div>
      ))}
    </section>
  );
}
