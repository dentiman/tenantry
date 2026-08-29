import { useTranslation } from 'react-i18next';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';

/**
 * Три стани завантаження сторінки налаштувань в одному місці — щоб кожна
 * з п'яти сторінок не переписувала однаковий спінер і однакове повідомлення.
 */
export function SettingsStatus({
  isPending,
  isError,
  children,
}: {
  isPending: boolean;
  isError: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('settings');

  if (isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner aria-label={t('loading')} />
      </div>
    );
  }

  if (isError) {
    return <p className="py-4 text-sm text-destructive">{t('loadError')}</p>;
  }

  return <>{children}</>;
}
