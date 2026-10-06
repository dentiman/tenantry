import { useTranslation } from 'react-i18next';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { UserIdentity } from '@saas-skeleton/ui/components/user-identity';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { formatDateTime } from '@saas-skeleton/ui/lib/format';
import { usePlatformAuthMe } from '../../../api/generated/api';
import { ContentSection } from '../../../components/section/content-section';

/** Рядок «підпис → значення» — та сама форма, що на картці тенанта */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm text-foreground">{value}</span>
    </div>
  );
}

/**
 * Профіль оператора — READ-ONLY, на відміну від `/user-settings` у tenant-web.
 * `PATCH` для `platform_users` не існує (MT-3, MVP): оператора заводить
 * платформа сама, а не самообслуговування. Явний підпис-пояснення нижче, щоб
 * порожнеча форми читалась як рішення, а не як недороблене.
 */
export function UserSettingsProfilePage() {
  const { t } = useTranslation('user-settings');
  const { data, isPending, isError } = usePlatformAuthMe();

  return (
    <ContentSection>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/user-settings' }, { label: t('profile.title') }]}
        subtitle={t('profile.description')}
      />

      {isPending ? (
        <div className="flex justify-center py-10">
          <Spinner aria-label={t('loadingLabel')} />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">{t('profile.loadFailed')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <UserIdentity id={data.id} email={data.email} name={data.name} size="lg" />
          <Separator />
          <div>
            <Fact label={t('profile.email')} value={data.email} />
            <Separator />
            <Fact label={t('profile.name')} value={data.name ?? '—'} />
            <Separator />
            <Fact label={t('profile.createdAt')} value={formatDateTime(data.createdAt)} />
          </div>
          <p className="text-sm text-muted-foreground">{t('profile.readOnlyHint')}</p>
        </div>
      )}
    </ContentSection>
  );
}
