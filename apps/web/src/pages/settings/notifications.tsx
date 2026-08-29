import { useTranslation } from 'react-i18next';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { ContentSection } from '../../components/settings/content-section';
import { NotificationPreferences } from '../../components/notifications/notification-preferences';

/**
 * Той самий компонент преференсів, що і в панелі дзвінка — не копія: список типів
 * і правило «немутабельні приходять із бекенда» мусять бути в одному місці.
 * Кнопки «назад» тут немає (нікуди повертатись), тому `onBack` опційний.
 */
export function SettingsNotificationsPage() {
  const { t } = useTranslation('settings');

  return (
    <ContentSection title={t('notifications.title')} description={t('notifications.description')}>
      <PageBreadcrumbs
        items={[{ label: t('title'), to: '/settings' }, { label: t('notifications.title') }]}
      />
      <NotificationPreferences />
    </ContentSection>
  );
}
