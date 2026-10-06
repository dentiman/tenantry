import { useTranslation } from 'react-i18next';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { ContentSection } from '../../../components/section/content-section';
import { ActivityFeed } from '../components/activity-feed';
import { useSettingsActivity } from '../../../api/generated/api';

/**
 * Журнал змін налаштувань компанії — той самий `ActivityFeed`, що на картках
 * юзера й кастомера, але з іншим джерелом: воркспейс адресується не парою
 * `{entityType, entityId}`, а власним ендпоінтом (його id клієнту не віддається).
 */
export function SettingsActivityPage() {
  const { t } = useTranslation('settings');

  return (
    <ContentSection>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/settings' }, { label: t('activity.title') }]}
        subtitle={t('activity.description')}
      />
      <ActivityFeed
        entityType="tenant"
        entityId="self"
        useFeedQuery={({ cursor }) => useSettingsActivity({ cursor })}
      />
    </ContentSection>
  );
}
