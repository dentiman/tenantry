import { useTranslation } from 'react-i18next';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Field, FieldDescription, FieldLabel } from '@saas-skeleton/ui/components/ui/field';
import { Input } from '@saas-skeleton/ui/components/ui/input';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { formatDate, formatDateTime } from '@saas-skeleton/ui/lib/format';
import { useAccountGetProfile } from '../../api/generated/api';
import { ContentSection } from '../../components/section/content-section';
import { SettingsStatus } from './status';

/** Рядок «підпис → значення» — та сама форма, що на картці юзера */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm text-foreground">{children}</span>
    </div>
  );
}

/**
 * Факти акаунта, які юзер собі не міняє. Email тут read-only свідомо: його зміна
 * потребує підтвердження на нову адресу (окремий флоу), і поле, яке мовчки нічого
 * не робить, гірше за поле, яке чесно каже, до кого йти.
 */
export function UserSettingsAccountPage() {
  const { t } = useTranslation('user-settings');
  const { data, isPending, isError } = useAccountGetProfile();

  return (
    <ContentSection>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/user-settings' }, { label: t('account.title') }]}
        subtitle={t('account.description')}
      />
      <SettingsStatus isPending={isPending} isError={isError || !data}>
        {data && (
          <div className="flex flex-col gap-6">
            <Field>
              <FieldLabel htmlFor="account-email">{t('account.email')}</FieldLabel>
              <Input id="account-email" value={data.email} disabled readOnly />
              <FieldDescription>{t('account.emailHint')}</FieldDescription>
            </Field>

            <div className="flex flex-col divide-y divide-border">
              <Fact label={t('account.role')}>
                <Badge variant="secondary">{data.role}</Badge>
              </Fact>
              <Fact label={t('account.status')}>
                <Badge variant={data.isActive ? 'success' : 'secondary'}>
                  {data.isActive ? t('account.active') : t('account.disabled')}
                </Badge>
              </Fact>
              <Fact label={t('account.createdAt')}>{formatDate(data.createdAt)}</Fact>
              <Fact label={t('account.lastSeenAt')}>
                {data.lastSeenAt ? formatDateTime(data.lastSeenAt) : t('account.never')}
              </Fact>
            </div>
          </div>
        )}
      </SettingsStatus>
    </ContentSection>
  );
}
