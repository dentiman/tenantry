import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { useActivitiesFindWorkspace } from '../../../api/generated/api';
import { DashboardWidget } from '../../dashboard/components/widget';
import { ActivityFeed } from './activity-feed';

/**
 * «Остання активність» на дашборді — внесок модуля `activities` у слот `dashboardWidgets`
 * (`slot-fills.ts`): дашборд журналу не імпортує (docs/modules.md §4).
 *
 * Стрічка по ВСЬОМУ воркспейсу, тобто події всіх колег, а не лише власні. Це той самий
 * `ActivityFeed`, що на картках юзера й кастомера: інший лише ендпоінт (`GET /activities/workspace`).
 * Склад стрічки задає сервер — лише типи, які власник дозволив показувати кожному юзеру
 * (docs/activity-log.md): безпекових і календарних подій тут немає, тож віджет безпечно
 * показувати і не-адміну.
 *
 * Межа висоти живе тут, а не у стрічці: вона нескінченна (курсорна), і обмежувати її мусить
 * оболонка. `h-108` — та сама висота, що в агенди календаря, тож сусідні плитки рядка рівні.
 */
export function DashboardActivityWidget() {
  const { t } = useTranslation('activities');

  return (
    <DashboardWidget title={t('widget.title')}>
      <div className="flex h-108 min-h-0 flex-col">
        {/* `entityType`/`entityId` — формальні: стрічка воркспейсу не адресується сутністю,
            фід бере власний хук (так само, як журнал налаштувань) */}
        <ScrollArea className="min-h-0 flex-1" contentClassName="px-0.5">
          <ActivityFeed
            entityType="workspace"
            entityId="all"
            useFeedQuery={({ cursor }) => useActivitiesFindWorkspace({ cursor })}
          />
        </ScrollArea>
      </div>
    </DashboardWidget>
  );
}
