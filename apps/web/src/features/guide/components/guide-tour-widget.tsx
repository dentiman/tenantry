import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon, CompassIcon, XIcon } from 'lucide-react';
import { Button, buttonVariants } from '@saas-skeleton/ui/components/ui/button';
import { Card } from '@saas-skeleton/ui/components/ui/card';
import { cn } from '@saas-skeleton/ui/lib/utils';
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
    // Звичайна картка з тоном `warning`, а не власна «скляна» поверхня: доти це
    // був єдиний на весь продукт блок із власним CSS — трьома рухомими плямами,
    // вуаллю і градієнтною рамкою. Тон і так несе ту саму думку («подивись
    // сюди»), а теплим лишається те, що й мало бути теплим: іконка і заголовок.
    // Разом із плиткою пішов і `guide-tour-widget.css` з усіма `--tour-*`.
    // `role="region"` + `aria-labelledby` замість `<section>`: `Card` рендериться
    // як `div` і пропа `render` не має, а для скрінрідера ця пара — рівно те
    // саме, що іменована секція
    <Card
      role="region"
      aria-labelledby="guide-tour-title"
      tone="warning"
      // `fill="subtle"` — найтихіший ступінь тону (4% замість 18%, `card-surface.css`):
      // лише натяк теплого кольору, плитка майже зрівняна з нейтральними віджетами
      // дашборда. Рішення власника 2026-11-12 (до того — `muted`, 9%).
      fill="subtle"
      className="flex-row gap-3 p-4 lg:col-span-3"
    >
      <CompassIcon className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />

      {/* Колонкою завжди, без `sm:flex-row`: брейкпоінт Tailwind меряє ВІКНО, а плитка
          живе в колонці, яку з'їдають сайдбар і панель асистента, — рядок із текстом
          і чипами стискав би текст у вузьку смугу */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="guide-tour-title" className="text-base font-medium text-warning">
            {t('tour.title')}
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('tour.lead')}</p>
        </div>
        <nav aria-label={t('tour.title')} className="flex flex-wrap gap-2">
          {TOUR_SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <Link
                key={section.id}
                to="/guide"
                hash={section.id}
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm', radius: 'full' }))}
              >
                <Icon data-icon="inline-start" />
                {t(`sections.${section.id}`)}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Усі кнопки плитки — `secondary`, рішення користувача. Різновид тут
          доречний саме тому, що його заливка — накладка `--foreground`, а не
          власний колір: на теплій картці кнопки виходять теплими й не несуть
          жодної межі. `outline` давав рівно протилежне — обводку, яка на тоні
          читалась чужою рамкою, а `elevated` — білу плитку з власною межею й
          тінню. Вага всіх трьох однакова свідомо: ієрархію тут тримають
          розташування (вхід праворуч, чипи під текстом) і стрілка, а не колір.
          `cn()` навколо `buttonVariants` обов'язковий: без tailwind-merge
          `rounded-md` розміру `sm` перебиває `rounded-full` (`Button` робить
          це сам, `Link` — ні) */}
      <div className="flex shrink-0 items-start gap-2">
        <Link
          to="/guide"
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm', radius: 'full' }))}
        >
          {t('tour.open')}
          <ArrowRightIcon data-icon="inline-end" />
        </Link>
        <Button
          variant="secondary"
          size="icon-sm"
          radius="full"
          aria-label={t('tour.dismiss')}
          onClick={dismiss}
        >
          <XIcon />
        </Button>
      </div>
    </Card>
  );
}
