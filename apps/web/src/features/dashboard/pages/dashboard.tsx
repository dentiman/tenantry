import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@saas-skeleton/ui/components/ui/card';
import { Skeleton } from '@saas-skeleton/ui/components/ui/skeleton';
import { useAuthMe } from '../../../api/generated/api';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { formatDate } from '@saas-skeleton/ui/lib/format';
import { DashboardWidgetPlaceholder } from '../components/widget';
import { dashboardWidgets } from '../components/slots';
import { SlotOutlet } from '../../../lib/slots';

/**
 * Дашборд — ДОСКА ВІДЖИТІВ: кожен блок картка, кожна картка володіє своїми
 * даними і своїм станом завантаження.
 *
 * Через це сторінка не має спільного «loading»: спінер на весь екран чекав би
 * на `GET /auth/me` і тримав порожнім віджит агенди, якому цей запит не
 * потрібен узагалі. Ідентичність показує скелет на своєму місці, решта доски
 * малюється одразу.
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
  const { data: me, isPending } = useAuthMe();

  const cards = [
    { label: t('signedInAs'), value: me?.email, truncate: true },
    { label: t('role'), value: me?.role, truncate: false },
    { label: t('memberSince'), value: formatDate(me?.createdAt), truncate: false },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader label="DashboardPage" breadcrumbs={[{ label: t('title') }]} />

      {/* Рядок ідентичності — не віджит: три однорядкові факти про сесію, які
          не мають ні власної дії, ні межі висоти. Вони лишаються шапкою доски */}
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label} size="sm">
            <CardContent>
              <p className="text-xs tracking-wide text-muted-foreground uppercase">{card.label}</p>
              {isPending ? (
                <Skeleton className="mt-1.5 h-5 w-40" />
              ) : (
                <p
                  className={`mt-1 text-lg font-medium text-foreground${card.truncate ? ' truncate' : ''}`}
                >
                  {card.value}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

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
