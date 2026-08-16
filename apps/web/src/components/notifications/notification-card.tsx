import { Dropdown } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import type { NotificationResponseDtoOutput } from '../../api/generated/model/notificationResponseDtoOutput';
import { formatDateTime } from '../../lib/format';
import { NotificationMessage } from './notification-message';

type Notification = NotificationResponseDtoOutput;

export interface NotificationMenuItem {
  id: string;
  label: string;
}

interface NotificationCardProps {
  notification: Notification;
  /** Клік по тілу картки; без нього картка не інтерактивна */
  onOpen?: () => void;
  /**
   * Круглий хрестик у ЛІВОМУ верхньому куті — ТІЛЬКИ для тоста (як у macOS):
   * він прибирає з екрана те, що спливло. У центрі його немає: там картка не
   * «закривається», а має стан, і керує ним меню.
   */
  onClose?: () => void;
  closeLabel?: string;
  /** Меню ⋯ у правому верхньому куті — ТІЛЬКИ для центру */
  menu?: {
    ariaLabel: string;
    items: NotificationMenuItem[];
    onAction: (id: string) => void;
  };
  /** Без посилань на сутність: у тості вся картка — одна ціль кліку */
  plain?: boolean;
  className?: string;
}

/**
 * ОДИН елемент сповіщення — і як спливний тост, і як рядок у центрі сповіщень.
 *
 * Так це працює в macOS: те, що щойно спливло збоку, лежить у центрі тим самим
 * бабликом. Дві різні верстки для одного й того самого повідомлення розходяться
 * при першій же зміні, тому картка тут одна, а хости різні: `NotificationItem`
 * (список) і `NotificationToastItem` (тост).
 *
 * Керування різне і це навмисно: тост отримує круглий × ліворуч угорі (прибрати
 * з екрана), центр — меню ⋯ праворуч (змінити стан). Одне й те саме в обох місцях
 * означало б різні дії під однаковою іконкою.
 */
export function NotificationCard({
  notification,
  onOpen,
  onClose,
  closeLabel,
  menu,
  plain = false,
  className = '',
}: NotificationCardProps) {
  const { t } = useTranslation('notifications');
  const isUnread = notification.readAt === null;
  const isInteractive = onOpen !== undefined;
  /**
   * Роль кнопки можна дати ТІЛЬКИ коли всередині немає власної інтерактивності:
   * у центрі текст містить посилання на сутність, і `role="button"` з лінком
   * усередині — невалідна ARIA (клавіатура заплуталась би, що саме активує Enter).
   * Там мишачий клік лишається, а клавіатурний шлях дає сам лінк.
   *
   * У тості лінків немає (`plain`), і роль кнопки там обовʼязкова: інакше з
   * клавіатури центр сповіщень із тоста не відкрити взагалі.
   */
  const asButton = isInteractive && plain;

  return (
    <div
      className={`group relative rounded-xl border border-border bg-surface px-3 py-2.5 shadow-lg transition-colors ${
        menu ? 'pr-10' : ''
      } ${
        isUnread ? 'bg-background-secondary' : ''
      } ${isInteractive ? 'cursor-pointer hover:border-accent/50' : ''} ${className}`}
      role={asButton ? 'button' : undefined}
      tabIndex={asButton ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={
        asButton
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
    >
      <div className="flex items-start gap-2">
        {/* Крапка непрочитаного — замість рамки збоку: у тості рамки немає, а
            стан має читатися однаково в обох хостах */}
        <span
          aria-hidden="true"
          className={`mt-1.5 size-1.5 shrink-0 rounded-full ${isUnread ? 'bg-accent' : 'bg-transparent'}`}
        />
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${isUnread ? 'text-foreground' : 'text-muted'}`}>
            <NotificationMessage notification={notification} plain={plain} />
          </p>
          <time className="text-xs text-muted" dateTime={notification.updatedAt}>
            {formatDateTime(notification.updatedAt)}
          </time>
        </div>
      </div>

      {/* Круглий хрестик у ЛІВОМУ верхньому куті із заходом на край — як у macOS.
          hidden/flex, а не opacity: невидима кнопка не має ловити кліки (попапа
          він не відкриває, тому зникнення з розкладки нічому не шкодить) */}
      {onClose && (
        <button
          type="button"
          aria-label={closeLabel}
          title={closeLabel}
          className="absolute -left-2 -top-2 z-10 hidden size-5 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md hover:bg-danger hover:text-white group-focus-within:flex group-hover:flex"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="size-2.5"
            aria-hidden="true"
          >
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      )}

      {/* Тут САМЕ opacity, а не hidden: `hidden` викидає тригер із розкладки, і
          щойно миша йде з картки на відкрите меню, попап втрачає якір і
          перестрибує в інший кут екрана. pointer-events знімає клікабельність,
          поки кнопки не видно */}
      {menu && (
        <div className="absolute right-1.5 top-1.5 flex items-center opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 pointer-events-none">
          <Dropdown>
            <Dropdown.Trigger
              aria-label={menu.ariaLabel}
              className="flex size-6 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md hover:bg-surface"
              // Меню — не «відкрити сповіщення»: клік не має підніматися до картки
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              {/* Інлайн-SVG: пакетів іконок у проєкті свідомо немає */}
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden="true">
                <circle cx="4" cy="10" r="1.5" />
                <circle cx="10" cy="10" r="1.5" />
                <circle cx="16" cy="10" r="1.5" />
              </svg>
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu onAction={(key) => { menu.onAction(String(key)); }}>
                {menu.items.map((item) => (
                  <Dropdown.Item key={item.id} id={item.id} textValue={item.label}>
                    {item.label}
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      )}

      {/* Службовий текст для скрінрідера: скільки подій зібрано в цій картці */}
      {notification.groupCount > 1 && (
        <span className="sr-only">{t('groupCount', { count: notification.groupCount })}</span>
      )}
    </div>
  );
}
