import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGridIcon } from 'lucide-react';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@saas-skeleton/ui/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { cn } from '@saas-skeleton/ui/lib/utils';

/**
 * Віджит дашборда — БЛОК-КАРТКА з назвою, необовʼязковою дією в правому куті
 * шапки і вмістом, який сам розпоряджається рештою висоти.
 *
 * Конфігурації (склад, порядок, розмір плиток) поки немає свідомо: доки віджит
 * один, «дашборд-двигун» був би каркасом без споживача. Тому контракт тут
 * рівно той, який знадобиться і потім: назва + дія + вміст. Коли зʼявиться
 * налаштування, змінюється те, ХТО рендерить цей компонент, а не він сам.
 *
 * `h-full` на картці, а не фіксована висота: рядок гріда і так тягнеться по
 * найвищій плитці (`align-items: stretch`), тож висоту задає ВМІСТ найбільшого
 * віджита, а сусіди — включно з плейсхолдерами — до нього дотягуються.
 */
export function DashboardWidget({
  title,
  action,
  children,
  className,
}: {
  title: ReactNode;
  /** Права зона шапки: посилання «відкрити розділ», перемикач періоду тощо */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex h-full flex-col', className)}>
      {/* `items-center` перебиває стоковий `items-start` реєстру: той
          розрахований на шапку з `CardDescription` під заголовком (тоді верх
          вирівнює перший рядок тексту з кнопкою). Тут другого рядка немає —
          лишається одна лінія тексту проти кнопки заввишки з `size="sm"`
          (32px). Самого `items-center` на `CardHeader` замало: `CardAction`
          сам несе `self-start` (щоб не залежати від сусідів, коли рядків
          два), тому його треба перебити тут-таки `self-center` */}
      <CardHeader className="items-center">
        <CardTitle>{title}</CardTitle>
        {/* `CardAction` — стокова частина картки: саме вона перемикає шапку в
            дві колонки (`has-data-[slot=card-action]`), тому дія не вимагає
            власного flex-рядка */}
        {action ? <CardAction className="self-center">{action}</CardAction> : null}
      </CardHeader>
      {/* `min-h-0` обовʼязковий: без нього вміст зі власним скролом (агенда)
          розпирав би картку на всю свою висоту замість того, щоб скролитись */}
      <CardContent className="flex min-h-0 flex-1 flex-col">{children}</CardContent>
    </Card>
  );
}

/**
 * Зайняте місце під майбутній віджит: сіра плитка з пунктиром і підписом
 * «coming soon».
 *
 * Це НЕ картка з порожнім вмістом, а `Empty` — та сама родина порожніх станів,
 * що в решті застосунку (правило «кустарних обгорток над примітивами не
 * заводимо»). Пунктир і приглушений фон читаються як «тут ще нічого немає»
 * самі, без слова «placeholder»: суцільна межа й `bg-card` зробили б плитку
 * повноцінною карткою, вміст якої не завантажився.
 */
export function DashboardWidgetPlaceholder({ className }: { className?: string }) {
  const { t } = useTranslation('dashboard');

  return (
    <Empty
      className={cn(
        // Межа тут окремим класом: у `Empty` стоковий лише `border-dashed`
        // (СТИЛЬ межі), а самої межі немає — її ставить споживач
        'min-h-48 border border-border bg-muted/30',
        className,
      )}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-muted text-muted-foreground">
          <LayoutGridIcon />
        </EmptyMedia>
        <EmptyTitle className="text-muted-foreground">{t('placeholder.title')}</EmptyTitle>
        <EmptyDescription>{t('placeholder.hint')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
