import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@saas-skeleton/ui/components/ui/card';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { ActivityFeed } from './activity-feed';

interface ActivityPanelProps {
  entityType: string;
  entityId: string;
  /** Класи кореня — позиція в сітці лишається за сторінкою */
  className?: string;
}

/**
 * Стрічка подій сутності як ПОСТІЙНА бічна панель картки — замість вкладки, у яку
 * треба було перемкнутись, щоб дізнатись, чи щось узагалі відбувалось. Історія
 * тепер видно одночасно з даними, і саме тому вона в колонці, а не в основній
 * частині: це супровід до змісту, а не окремий розділ.
 *
 * Рішення розкладки:
 * - **Своя висота і власний скрол**, а не зростання разом зі списком: журнал
 *   необмежений, і без стелі права колонка визначала б висоту сторінки, а картки
 *   зліва висіли б у порожнечі. На вузьких екранах стеля фіксована (панель іде
 *   під контент), на широких — рахується від вьюпорта.
 * - **`sticky` тільки з `lg`**: коли колонки стають одна під одною, липкість
 *   зробила б панель, що переслідує контент, — на мобільному це шкода, а не поміч.
 *   Зсув `top` = висота липкого хедера (3.5rem) + відступ контенту (1rem).
 * - Всередині — той самий `ActivityFeed`, що в драйвері й у журналі налаштувань:
 *   ліниве довантаження працює у вкладеному скролі без окремого налаштування.
 */
export function ActivityPanel({ entityType, entityId, className }: ActivityPanelProps) {
  const { t } = useTranslation('activities');

  return (
    <Card
      className={cn(
        'max-h-[32rem] lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-7rem)]',
        className,
      )}
    >
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      {/* min-h-0 обовʼязковий: без нього flex-нащадок не стискається нижче
          власного вмісту і скрол ніколи не вмикається */}
      <CardContent className="min-h-0 flex-1 overflow-y-auto">
        <ActivityFeed entityType={entityType} entityId={entityId} />
      </CardContent>
    </Card>
  );
}
