import { useTranslation } from 'react-i18next';
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
      <button
        type="button"
        aria-label={count > 0 ? t('unreadBadge', { count }) : t('open')}
        className="relative cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-background-secondary hover:text-foreground"
        onClick={openPanel}
      >
        {/* Інлайн-SVG: пакетів іконок у проєкті свідомо немає */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-5"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      <NotificationPanel isOpen={isOpen} onClose={closePanel} />
    </>
  );
}
