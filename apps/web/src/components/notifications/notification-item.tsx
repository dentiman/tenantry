import { useTranslation } from 'react-i18next';
import type { NotificationResponseDtoOutput } from '../../api/generated/model/notificationResponseDtoOutput';
import { entityLink } from '../../lib/entity-routes';
import { NotificationCard } from './notification-card';

type Notification = NotificationResponseDtoOutput;

interface NotificationItemProps {
  notification: Notification;
  onOpen: (notification: Notification) => void;
  onSetRead: (notification: Notification, read: boolean) => void;
  onSetArchived: (notification: Notification, archived: boolean) => void;
}

/**
 * Рядок центру сповіщень — той самий `NotificationCard`, що спливає тостом,
 * але керування інше: тут ⋯ (стан рядка), а круглий × лишається привілеєм тоста.
 * Причина проста: у тості закриття прибирає повідомлення з ЕКРАНА, а в центрі
 * прибрати його можна лише разом зі станом — інакше воно повернулося б при
 * наступному відкритті панелі.
 *
 * Доменних кнопок у картці немає свідомо: дія над сутністю живе на її сторінці,
 * де є контекст і валідація (docs/notifications.md, зафіксоване рішення).
 */
export function NotificationItem({
  notification,
  onOpen,
  onSetRead,
  onSetArchived,
}: NotificationItemProps) {
  const { t } = useTranslation('notifications');
  const isUnread = notification.readAt === null;
  const isArchived = notification.archivedAt !== null;
  // Ціль може бути невідомого фронту типу — тоді картка не клікабельна, але
  // прочитати/архівувати її все одно можна
  const hasTarget =
    notification.target !== null &&
    entityLink(notification.target.kind, notification.target.id) !== null;

  return (
    <li>
      <NotificationCard
        notification={notification}
        onOpen={
          hasTarget
            ? () => {
                onOpen(notification);
              }
            : undefined
        }
        // Хрестика в центрі немає свідомо: тут картка не «закривається», а має
        // стан — прибирання в архів живе в меню, поруч із рештою дій над станом
        menu={{
          ariaLabel: t('rowActions'),
          items: [
            { id: 'read', label: isUnread ? t('markRead') : t('markUnread') },
            { id: 'archive', label: isArchived ? t('unarchive') : t('archive') },
          ],
          onAction: (id) => {
            if (id === 'read') {
              onSetRead(notification, isUnread);
            } else {
              onSetArchived(notification, !isArchived);
            }
          },
        }}
      />
    </li>
  );
}
