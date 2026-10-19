import { useTranslation } from 'react-i18next';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { DashboardWidgetPlaceholder } from '../components/widget';
import { dashboardWidgets } from '../components/slots';
import { SlotOutlet } from '../../../lib/slots';

/**
 * Дашборд — ДОСКА ВІДЖИТІВ: кожен блок картка, кожна картка володіє своїми
 * даними і своїм станом завантаження.
 *
 * Через це сторінка не має спільного «loading»: кожен віджит показує скелет
 * на своєму місці, решта доски малюється одразу.
 *
 * Віджети приходять від фіч через слот `dashboardWidgets` (агенда — від
 * календаря, остання активність — від журналу, `slot-fills.ts`); дашборд не знає, хто їх поклав.
 *
 * Конфігурації доски (склад, порядок, розміри) поки немає: доки справжніх
 * віджитів два, «дашборд-двигун» був би каркасом без споживача. Порожні місця
 * тримають пунктирні плитки — вони і показують, що доска росте, і дають
 * побачити її розкладку до появи вмісту.
 */
export function DashboardPage() {
  const { t } = useTranslation('dashboard');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader label="DashboardPage" breadcrumbs={[{ label: t('title') }]} />

      {/* Доска: три колонки на широкому екрані, одна на телефоні. Плитки
          рівновисокі самі — рядок гріда тягнеться по найвищій (агенді), а
          плейсхолдери до неї дотягуються */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SlotOutlet slot={dashboardWidgets} props={{}} />
        <DashboardWidgetPlaceholder />
        {/* Широке місце окремим рядком: майбутні віджити не всі однакові за
            формою (графік, стрічка подій), і доска мусить це показувати вже
            зараз — інакше перший же широкий віджит виглядатиме як виняток */}
        <DashboardWidgetPlaceholder className="min-h-48 lg:col-span-3" />
      </div>
    </div>
  );
}
