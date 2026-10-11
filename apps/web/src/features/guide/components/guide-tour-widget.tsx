import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon, XIcon } from 'lucide-react';
import { Button, buttonVariants } from '@saas-skeleton/ui/components/ui/button';
import { DashboardWidget } from '../../dashboard/components/widget';
import { GUIDE_SECTIONS } from '../pages/guide.content';
import { useGuideTourStore } from '../stores/guide-tour.store';

/**
 * Параграфи, на які веде плитка. «Overview» тут зайвий: на нього веде головна
 * кнопка «Open the guide» (путівник відкривається з початку), а чипи — це
 * вибірковий вхід туди, де відвідувач найчастіше шукає відповідь.
 */
const TOUR_SECTIONS = GUIDE_SECTIONS.filter((section) => section.id !== 'overview');

/**
 * Плитка-вхід у путівник на дашборді — внесок модуля `guide` у слот
 * `dashboardWidgets` (`slot-fills.ts`): дашборд путівника не імпортує
 * (docs/modules.md §4).
 *
 * Дашборд лишається першим екраном застосунку, а путівник — окремою сторінкою
 * (`/guide`): плитка не дублює його вміст, а лише показує, що він є, і веде в
 * потрібний параграф. Тому вона низька (щоб віджети лишались на першому екрані)
 * і закривається — вибір зберігає `guide-tour.store.ts`. Іконка путівника в
 * рейлі лишається назавжди, тож закрита плитка нічого не відбирає.
 *
 * Посилання ведуть на `/guide#<параграф>`: URL путівника не змінюється при
 * прокрутці, але на вході хеш читається (`useGuideScrollSpy`).
 */
export function GuideTourWidget() {
  const { t } = useTranslation('guide');
  const dismissed = useGuideTourStore((state) => state.dismissed);
  const dismiss = useGuideTourStore((state) => state.dismiss);

  if (dismissed) return null;

  return (
    <DashboardWidget
      className="lg:col-span-3"
      title={t('tour.title')}
      action={
        <div className="flex items-center gap-1">
          <Link to="/guide" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {t('tour.open')}
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
          <Button variant="ghost" size="icon-sm" aria-label={t('tour.dismiss')} onClick={dismiss}>
            <XIcon />
          </Button>
        </div>
      }
    >
      {/* Колонкою завжди, без `sm:flex-row`: брейкпоінт Tailwind меряє ВІКНО, а плитка
          живе в колонці, яку з'їдають сайдбар і панель асистента, — рядок із текстом
          і чипами стискав би текст у вузьку смугу */}
      <div className="flex flex-col gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('tour.lead')}</p>
        <nav aria-label={t('tour.title')} className="flex flex-wrap gap-2">
          {TOUR_SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <Link
                key={section.id}
                to="/guide"
                hash={section.id}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <Icon data-icon="inline-start" />
                {t(`sections.${section.id}`)}
              </Link>
            );
          })}
        </nav>
      </div>
    </DashboardWidget>
  );
}
