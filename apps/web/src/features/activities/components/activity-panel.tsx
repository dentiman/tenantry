import { ActivityPanel as SharedActivityPanel } from '@saas-skeleton/ui/activities';
import { entityFeedQuery } from './activity-feed';

interface ActivityPanelProps {
  entityType: string;
  entityId: string;
  /** Класи кореня — позиція в сітці лишається за сторінкою */
  className?: string;
}

/** Бічна панель стрічки сутності на картці (кастомер, юзер) — спільна з platform-web */
export function ActivityPanel({ entityType, entityId, className }: ActivityPanelProps) {
  return (
    <SharedActivityPanel
      feedKey={`${entityType}:${entityId}`}
      useFeedQuery={entityFeedQuery(entityType, entityId)}
      className={className}
    />
  );
}
