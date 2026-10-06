import { useTranslation } from 'react-i18next';
import { ThemeSwitcher } from '@saas-skeleton/ui/components/theme-switcher';
import { ThemeSelect } from '@saas-skeleton/ui/components/theme-select';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { ContentSection } from '../../../components/section/content-section';

/**
 * Єдине суто клієнтське налаштування: тема живе в localStorage (next-themes), у БД
 * її немає. Мова, навпаки, у профілі — її читає worker, коли рендерить email.
 */
export function UserSettingsAppearancePage() {
  const { t } = useTranslation('user-settings');

  return (
    <ContentSection>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/user-settings' }, { label: t('appearance.title') }]}
        subtitle={t('appearance.description')}
      />
      <div className="flex items-center justify-between gap-4 py-1.5">
        <span className="text-sm text-foreground">{t('appearance.theme')}</span>
        <ThemeSwitcher />
      </div>
      <div className="flex items-center justify-between gap-4 py-1.5">
        <div>
          <span className="text-sm text-foreground">{t('appearance.palette')}</span>
          <p className="text-sm text-muted-foreground">{t('appearance.paletteDescription')}</p>
        </div>
        <ThemeSelect />
      </div>
    </ContentSection>
  );
}
