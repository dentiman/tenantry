import { useTranslation } from 'react-i18next';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { ContentSection } from '../../components/section/content-section';
import { ActivityFeed } from '../../components/activity/activity-feed';
import { useSettingsActivity } from '../../api/generated/api';

/**
 * Журнал змін налаштувань компанії — той самий `ActivityFeed`, що на картках
 * юзера й кастомера, але з іншим джерелом: воркспейс адресується не парою
 * `{entityType, entityId}`, а власним ендпоінтом (його id клієнту не віддається).
 */
export function SettingsActivityPage() {
  const { t } = useTranslation('settings');

  return (
    <ContentSection title={t('activity.title')} description={t('activity.description')}>
      <PageBreadcrumbs
        items={[{ label: t('title'), to: '/settings' }, { label: t('activity.title') }]}
      />
      <ActivityFeed
        entityType="tenant"
        entityId="self"
        useFeedQuery={({ cursor }) => useSettingsActivity({ cursor })}
      />
    </ContentSection>
  );
}
