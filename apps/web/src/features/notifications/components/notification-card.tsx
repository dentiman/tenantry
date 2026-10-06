import { MoreHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@saas-skeleton/ui/components/ui/dropdown-menu';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
} from '@saas-skeleton/ui/components/ui/item';
import type { NotificationResponseDtoOutput } from '../../../api/generated/model/notificationResponseDtoOutput';
import { formatDateTime } from '@saas-skeleton/ui/lib/format';
import { cn } from '@saas-skeleton/ui/lib/utils';
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
  /**
   * Картка висить НАД сторінкою (тост), а не лежить рядком у списку. Різниця
   * не косметична: спливна поверхня несе власний фон і тінь оверлея, рядок
   * списку — ні. Доки цієї межі не було, кожен рядок центру кидав тінь рівня
   * «попап» і носив `bg-popover` поверх такого самого фону панелі.
   */
  floating?: boolean;
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
 *
 * Розкладку дає `Item` реєстру, а в `plain`-режимі він рендериться СПРАВЖНЬОЮ
 * кнопкою (`render`) — попередній `role="button"` + `tabIndex` + ручний `onKeyDown`
 * зник (docs/frontend/ui-migration-history.md §4). У центрі кнопкою бути не можна:
 * усередині тексту є посилання на сутність, а лінк у кнопці — невалідна ARIA.
 */
export function NotificationCard({
  notification,
  onOpen,
  onClose,
  closeLabel,
  menu,
  plain = false,
  floating = false,
  className = '',
}: NotificationCardProps) {
  const { t } = useTranslation('notifications');
  const isUnread = notification.readAt === null;
  const isInteractive = onOpen !== undefined;
  const asButton = isInteractive && plain;

  return (
    // Обгортка потрібна саме тут: у plain-режимі сама картка є <button>, а кнопки
    // закриття і меню мусять лишитись ЗОВНІ неї — кнопка в кнопці невалідна
    <div className={`group relative ${className}`}>
      <Item
        variant="default"
        size="sm"
        render={asButton ? <button type="button" /> : undefined}
        className={cn(
          'w-full items-start text-left transition-colors',
          // Той самий матеріал, що картки дашборда (`Card`): без обводки
          // (variant="default" — border-transparent), світла тінь замість
          // межі. У світлій темі тінь читається (bg-card біліший за
          // bg-sidebar панелі); у темній тіні не працюють — підняття дає
          // світліший колір (bg-popover світліший за bg-sidebar/card у
          // темній темі), а не shadow. Однаково незалежно від read/unread —
          // стан непрочитаного показує крапка + жирність тексту нижче
          floating ? 'bg-popover shadow-lg' : 'bg-card shadow-sm dark:bg-popover dark:shadow-none',
          menu && 'pr-10',
          // Наведення НЕ міняє колір: блакитна обводка `hover:border-primary/50`
          // тут читалась як стан «вибрано» — брендовий колір у списку означає
          // дію, а не «під курсором». Клікабельність показує курсор
          isInteractive && 'cursor-pointer',
        )}
        onClick={onOpen}
      >
        {/* Крапка непрочитаного — замість рамки збоку: у тості рамки немає, а
          стан має читатися однаково в обох хостах */}
        <ItemMedia>
          <span
            aria-hidden="true"
            className={`mt-1.5 size-1.5 shrink-0 rounded-full ${isUnread ? 'bg-primary' : 'bg-transparent'}`}
          />
        </ItemMedia>

        <ItemContent className="min-w-0 gap-0.5">
          <p className={`text-sm ${isUnread ? 'text-foreground' : 'text-muted-foreground'}`}>
            <NotificationMessage notification={notification} plain={plain} />
          </p>
          <ItemDescription className="text-xs">
            <time dateTime={notification.updatedAt}>{formatDateTime(notification.updatedAt)}</time>
          </ItemDescription>
        </ItemContent>

        {/* Службовий текст для скрінрідера: скільки подій зібрано в цій картці */}
        {notification.groupCount > 1 && (
          <span className="sr-only">{t('groupCount', { count: notification.groupCount })}</span>
        )}
      </Item>

      {/* Круглий хрестик у ЛІВОМУ верхньому куті із заходом на край — як у macOS.
          hidden/flex, а не opacity: невидима кнопка не має ловити кліки */}
      {onClose && (
        <Button
          type="button"
          variant="secondary"
          size="icon-xs"
          radius="full"
          aria-label={closeLabel}
          title={closeLabel}
          className="absolute -top-2 -left-2 z-10 hidden size-5 shadow-md group-focus-within:flex group-hover:flex"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X className="size-2.5" />
        </Button>
      )}

      {/* Тут САМЕ opacity, а не hidden: `hidden` викидає тригер із розкладки, і
          щойно миша йде з картки на відкрите меню, попап втрачає якір і
          перестрибує в інший кут екрана */}
      {menu && (
        <div className="pointer-events-none absolute top-1.5 right-1.5 flex items-center opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="secondary"
                  size="icon-xs"
                  radius="full"
                  aria-label={menu.ariaLabel}
                  className="size-6 shadow-md"
                  // Меню — не «відкрити сповіщення»: клік не має підніматися до картки
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuGroup>
                {menu.items.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    onClick={() => {
                      menu.onAction(item.id);
                    }}
                  >
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
