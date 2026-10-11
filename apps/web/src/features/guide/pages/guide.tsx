import { useTranslation } from 'react-i18next';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { GuideContent } from './guide-content';

/**
 * Путівник усередині шела (area «Guide», `/guide`): крихта в хедері шела й спільне
 * тіло `GuideContent`. Публічна копія без шела — `AboutPage` (`/about`); вміст
 * в обох один, різниться лише рама (див. `guide-content.tsx`).
 */
export function GuidePage() {
  const { t } = useTranslation('layout');

  return (
    <>
      <PageHeader label="GuidePage" breadcrumbs={[{ label: t('areas.guide') }]} />
      <GuideContent />
    </>
  );
}
