import { useEffect, useState } from 'react';
import { Button, Drawer, Spinner } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  getNotificationsFindAllQueryKey,
  getNotificationsGetSummaryQueryKey,
  useNotificationsFindAll,
  useNotificationsMarkAllRead,
  useNotificationsMarkSeen,
  useNotificationsUpdate,
} from '../../api/generated/api';
import type { NotificationResponseDtoOutput } from '../../api/generated/model/notificationResponseDtoOutput';
import type { NotificationsFindAllFilter } from '../../api/generated/model/notificationsFindAllFilter';
import { entityRoute } from '../../lib/entity-routes';
import { NotificationItem } from './notification-item';
import { NotificationPreferences } from './notification-preferences';

type Notification = NotificationResponseDtoOutput;

const FILTERS: NotificationsFindAllFilter[] = ['unread', 'all', 'archived'];

/**
 * Панель інбокса. Drawer праворуч — той самий компонент, що ActivityDrawer:
 * поведінка і стилі вже відпрацьовані, а «спливашка з дзвінка» на вузьких
 * екранах усе одно перетворилась би на нього.
 *
 * Накопичення сторінок — як в ActivityDrawer (перша сторінка ЗАМІНЮЄ, наступні
 * дописуються з дедупом по id): useInfiniteQuery через orval — той самий беклог.
 */
export function NotificationPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation('notifications');
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<NotificationsFindAllFilter>('all');
  const [showSettings, setShowSettings] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<Notification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const { data, isFetching, isError } = useNotificationsFindAll(
    { filter, cursor },
    { query: { enabled: isOpen && !showSettings } },
  );

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: getNotificationsFindAllQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getNotificationsGetSummaryQueryKey() });
  };

  const { mutate: update } = useNotificationsUpdate({ mutation: { onSuccess: invalidate } });
  const { mutate: markAllRead } = useNotificationsMarkAllRead({ mutation: { onSuccess: invalidate } });
  const { mutate: markSeen } = useNotificationsMarkSeen();

  // Відкриття панелі гасить бейдж: рядки лишаються непрочитаними, але «нових»
  // із цієї миті немає. Саме це рятує від вічного «47» на іконці
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    markSeen(undefined, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getNotificationsGetSummaryQueryKey() });
      },
    });
  }, [isOpen, markSeen, queryClient]);

  // Скидання накопичення при зміні фільтра і при кожному новому відкритті:
  // компонент лишається в дереві, тому без isOpen у залежностях повторне
  // відкриття показувало б накопичене з минулого разу
  useEffect(() => {
    setCursor(undefined);
    setEntries([]);
    setNextCursor(null);
  }, [filter, isOpen]);

  useEffect(() => {
    if (!data) {
      return;
    }
    setEntries((prev) => {
      if (cursor === undefined) {
        return data.items;
      }
      const seen = new Set(prev.map((entry) => entry.id));
      return [...prev, ...data.items.filter((entry) => !seen.has(entry.id))];
    });
    setNextCursor(data.nextCursor);
  }, [data, cursor]);

  const open = (notification: Notification): void => {
    const route = notification.target ? entityRoute(notification.target.kind) : null;
    if (notification.readAt === null) {
      update({ id: notification.id, data: { read: true } });
    }
    // Закриваємо панель ТІЛЬКИ якщо клік справді кудись веде. Якщо цільова
    // сторінка вже відкрита, закриття виглядало б як «центр згорнувся сам собою»:
    // юзер натиснув на повідомлення, нічого не змінилось, а список зник
    if (route && route !== pathname) {
      void navigate({ to: route });
      onClose();
    }
  };

  const isInitialLoading = isFetching && entries.length === 0;

  return (
    <Drawer.Backdrop
      isOpen={isOpen}
      onOpenChange={(next) => {
        if (!next) {
          setShowSettings(false);
          onClose();
        }
      }}
    >
      <Drawer.Content placement="right">
        <Drawer.Dialog className="sm:max-w-[440px]">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>
              {showSettings ? t('settings.title') : t('title')}
            </Drawer.Heading>
            {!showSettings && (
              <div className="mt-3 flex items-center gap-1">
                {FILTERS.map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={filter === value ? 'primary' : 'ghost'}
                    onPress={() => {
                      setFilter(value);
                    }}
                  >
                    {t(`filter.${value}`)}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  aria-label={t('settings.open')}
                  onPress={() => {
                    setShowSettings(true);
                  }}
                >
                  ⚙
                </Button>
              </div>
            )}
          </Drawer.Header>

          <Drawer.Body>
            {showSettings ? (
              <NotificationPreferences
                onBack={() => {
                  setShowSettings(false);
                }}
              />
            ) : (
              <>
                {isInitialLoading && (
                  <div className="flex justify-center py-8">
                    <Spinner aria-label={t('loading')} />
                  </div>
                )}
                {isError && entries.length === 0 && (
                  <p className="py-8 text-center text-sm text-danger">{t('loadError')}</p>
                )}
                {!isInitialLoading && !isError && entries.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted">{t(`empty.${filter}`)}</p>
                )}
                {entries.length > 0 && (
                  <ol className="flex flex-col gap-1">
                    {entries.map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onOpen={open}
                        onSetRead={(item, read) => {
                          update({ id: item.id, data: { read } });
                        }}
                        onSetArchived={(item, archived) => {
                          update({ id: item.id, data: { archived } });
                        }}
                      />
                    ))}
                  </ol>
                )}
              </>
            )}
          </Drawer.Body>

          {!showSettings && (
            <Drawer.Footer className="flex gap-2">
              <Button
                className="flex-1"
                variant="secondary"
                onPress={() => {
                  markAllRead(undefined);
                }}
              >
                {t('markAllRead')}
              </Button>
              {nextCursor && (
                <Button
                  className="flex-1"
                  variant="ghost"
                  isPending={isFetching}
                  onPress={() => {
                    setCursor(nextCursor);
                  }}
                >
                  {t('loadMore')}
                </Button>
              )}
            </Drawer.Footer>
          )}
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
