import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { cn } from '../lib/utils';
import { ActivityFeed, type UseActivityFeedQuery } from './activity-feed';

interface ActivityPanelProps {
  /** Ідентичність стрічки — див. `ActivityFeed.feedKey` */
  feedKey: string;
  /** Джерело — хук згенерованого клієнта застосунку-хоста */
  useFeedQuery: UseActivityFeedQuery;
  /** Класи кореня — позиція в сітці лишається за сторінкою */
  className?: string;
}

/**
 * Стрічка подій як ПОСТІЙНА бічна панель картки (кастомер і юзер у tenant-web, тенант
 * у platform-web) — замість вкладки, у яку треба було перемкнутись, щоб дізнатись, чи
 * щось узагалі відбувалось. Історія тепер видно одночасно з даними, і саме тому вона в колонці, а не в основній
 * частині: це супровід до змісту, а не окремий розділ.
 *
 * Рішення розкладки:
 * - **Своя висота і власний скрол**, а не зростання разом зі списком: журнал
 *   необмежений, і без стелі права колонка визначала б висоту сторінки, а картки
 *   зліва висіли б у порожнечі. На вузьких екранах стеля фіксована (панель іде
 *   під контент), на широких — рахується від вьюпорта.
 * - **`sticky` тільки з `lg`**: коли колонки стають одна під одною, липкість
 *   зробила б панель, що переслідує контент, — на мобільному це шкода, а не поміч.
 *   Зсув `top` = відступ контенту (1rem), а не «хедер + відступ»: з 2026-09-09
 *   скролить `ScrollArea` ПІД хедером, тож його висота в координати скролера вже
 *   не входить.
 * - Всередині — той самий `ActivityFeed`, що в драйвері й у журналі налаштувань:
 *   ліниве довантаження працює у вкладеному скролі без окремого налаштування.
 */
export function ActivityPanel({ feedKey, useFeedQuery, className }: ActivityPanelProps) {
  const { t } = useTranslation('activities');

  return (
    <Card
      className={cn(
        // 6rem = хедер 3.5rem + pt-4 (1rem) + pb-6 (1.5rem)
        'max-h-[32rem] lg:sticky lg:top-4 lg:max-h-[calc(100svh-6rem)]',
        className,
      )}
    >
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      {/* min-h-0 обовʼязковий: без нього flex-нащадок не стискається нижче
          власного вмісту і скрол ніколи не вмикається */}
      <CardContent className="min-h-0 flex-1 overflow-y-auto">
        <ActivityFeed feedKey={feedKey} useFeedQuery={useFeedQuery} />
      </CardContent>
    </Card>
  );
}
