import { ActivityFeed as SharedActivityFeed } from '@saas-skeleton/ui/activities';
import type { UseActivityFeedQuery } from '@saas-skeleton/ui/activities';
import { useActivitiesFindAll } from '../../../api/generated/api';

interface ActivityFeedProps {
  entityType: string;
  /** null — сутність не обрана: запит не летить, стрічка не рендериться */
  entityId: string | null;
  /** Драйвер вимикає запит, поки закритий; сторінка тримає його увімкненим */
  isEnabled?: boolean;
  /**
   * Чим фетчити, якщо не стрічкою сутності. Перекривається там, де фід адресується не
   * парою `{entityType, entityId}`, а самим ендпоінтом: у воркспейсі сутність береться
   * з токена, і її id клієнту не віддається взагалі.
   */
  useFeedQuery?: UseActivityFeedQuery;
}

/**
 * Стрічка tenant-web: спільний `ActivityFeed` з `libs/ui` (той самий рендер, що на картці
 * тенанта в platform-web), прив'язаний до клієнта tenant-api. Дефолтне джерело — фід
 * сутності `GET /activities?entityType&entityId`.
 */
export function ActivityFeed({ entityType, entityId, isEnabled, useFeedQuery }: ActivityFeedProps) {
  return (
    <SharedActivityFeed
      feedKey={entityId === null ? null : `${entityType}:${entityId}`}
      isEnabled={isEnabled}
      useFeedQuery={useFeedQuery ?? entityFeedQuery(entityType, entityId)}
    />
  );
}

/** Джерело «фід сутності»; `isEnabled` вже враховує, що сутність обрано */
export function entityFeedQuery(entityType: string, entityId: string | null): UseActivityFeedQuery {
  return ({ cursor, isEnabled }) =>
    useActivitiesFindAll(
      { entityType, entityId: entityId ?? '', cursor },
      { query: { enabled: isEnabled } },
    );
}
