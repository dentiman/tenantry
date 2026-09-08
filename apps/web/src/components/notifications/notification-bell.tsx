import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { useNotificationsGetSummary } from '../../api/generated/api';
import { useNotificationUiStore } from '../../stores/notification-ui.store';
import { NotificationPanel } from './notification-panel';

/**
 * Дзвінок із бейджем. На бейджі — `newCount` (зʼявилося після останнього
 * відкриття панелі), а не `unreadCount`: інакше там за тиждень висіло б «47»
 * і число перестало б щось означати.
 *
 * Актуальність тримає socket (`notification-sync`), а не поллінг — той був би
 * саме тим, від чого realtime мав позбавити.
 */
export function NotificationBell() {
  const { t } = useTranslation('notifications');
  // Стан панелі — у сторі: її відкриває не лише цей компонент, а й клік по тосту
  const isOpen = useNotificationUiStore((s) => s.isPanelOpen);
  const openPanel = useNotificationUiStore((s) => s.openPanel);
  const closePanel = useNotificationUiStore((s) => s.closePanel);
  const { data } = useNotificationsGetSummary({
    query: {
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      // Недоступний інбокс — не привід для тоста: дзвінок просто без бейджа
      retry: false,
      meta: { silentError: true },
    },
  });

  const count = data?.newCount ?? 0;

  return (
    <>
      {/* icon-sm (32px) — метрика хедера шела: дзвінок стоїть в одному ряду з
          перемикачем теми і зоною дій сторінки, і стокові 36px робили його
          єдиним вищим елементом рядка */}
      <Button
        variant="ghost"
        size="icon-sm"
        className="relative"
        aria-label={count > 0 ? t('unreadBadge', { count }) : t('open')}
        onClick={openPanel}
      >
        <Bell />
        {count > 0 && (
          // Суцільна заливка, а не мʼякий destructive-варіант: лічильник має
          // читатися з відстані. Контраст пари задає тема окремо для light/dark.
          <Badge className="absolute -top-0.5 -right-0.5 h-4 min-w-4 bg-destructive px-1 text-[10px] text-destructive-foreground">
            {count > 99 ? '99+' : count}
          </Badge>
        )}
      </Button>

      <NotificationPanel isOpen={isOpen} onClose={closePanel} />
    </>
  );
}
