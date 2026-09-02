import { useTranslation } from 'react-i18next';
import { ThemeSwitcher } from '@saas-skeleton/ui/components/theme-switcher';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { ContentSection } from '../../components/section/content-section';

/**
 * Єдине суто клієнтське налаштування: тема живе в localStorage (next-themes), у БД
 * її немає. Мова, навпаки, у профілі — її читає worker, коли рендерить email.
 */
export function UserSettingsAppearancePage() {
  const { t } = useTranslation('user-settings');

  return (
    <ContentSection title={t('appearance.title')} description={t('appearance.description')}>
      <PageBreadcrumbs
        items={[{ label: t('title'), to: '/user-settings' }, { label: t('appearance.title') }]}
      />
      <div className="flex items-center justify-between gap-4 py-1.5">
        <span className="text-sm text-foreground">{t('appearance.theme')}</span>
        <ThemeSwitcher />
      </div>
    </ContentSection>
  );
}
