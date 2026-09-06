import { Link, useCanGoBack } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';

/**
 * Сторінка неіснуючого роуту — спільна для обох фронтів.
 *
 * «Головну» приймає пропом, а не хардкодить: у tenant-web корінь застосунку — це
 * area `/workspace` (docs/frontend/app-shell.md), у platform-web — `/`. Спільний
 * компонент не має знати шляхів конкретного плану, а `Link to` типізований
 * роутером ТОГО фронту, який його рендерить, тож хардкод там просто не збереться.
 *
 * Блок узятий із shadcn-admin (`src/features/errors/not-found-error.tsx`, MIT — той
 * самий шаблон, з якого приїхала розкладка `/settings`): великий номер помилки,
 * заголовок, пояснення і пара дій «назад / на головну». Але зібраний він на нашому
 * реєстровому `Empty`, а не рукописним `<div>`-ом, бо 404 — це порожній стан, а
 * кустарних обгорток над примітивами ми не заводимо (CLAUDE.md, правило 12).
 *
 * Рендериться ВСЕРЕДИНІ layout-а застосунку: сайдбар і хедер лишаються на місці,
 * тож із помилки видно, куди йти далі. Гість сюди не потрапляє — гейт роуту
 * (`beforeLoad` батьківського app-роуту) відправляє його на /login.
 */
export function NotFoundPage({ homeTo }: { homeTo: string }) {
  const { t } = useTranslation('common');
  // Кнопка «назад» має сенс лише коли в історії справді є куди повертатись:
  // на 404 часто приходять із зовнішнього посилання, і тоді вона винесла б із застосунку.
  const canGoBack = useCanGoBack();

  return (
    <>
      <PageBreadcrumbs items={[{ label: t('notFound.breadcrumb') }]} />
      <Empty className="h-full">
        <EmptyHeader>
          {/* Номер помилки замість іконки: variant="default" не малює плитку,
              тож цифра стоїть саме там, де в інших порожніх станах іконка */}
          <EmptyMedia className="text-6xl leading-none font-bold tracking-tight text-muted-foreground/40">
            404
          </EmptyMedia>
          <EmptyTitle className="text-lg">{t('notFound.title')}</EmptyTitle>
          <EmptyDescription>{t('notFound.description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {canGoBack && (
              <Button
                variant="outline"
                onClick={() => {
                  window.history.back();
                }}
              >
                {t('notFound.goBack')}
              </Button>
            )}
            <Button render={<Link to={homeTo} />}>{t('notFound.goHome')}</Button>
          </div>
        </EmptyContent>
      </Empty>
    </>
  );
}
