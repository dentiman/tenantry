import { useTranslation } from 'react-i18next';
import { ThemeSwitcher } from '@saas-skeleton/ui/components/theme-switcher';
import { ThemeSelect } from '@saas-skeleton/ui/components/theme-select';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { ContentSection } from '../../components/section/content-section';

/** Дзеркало `apps/web/src/pages/user-settings/appearance.tsx` — тема живе в localStorage, у БД її немає */
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
