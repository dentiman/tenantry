import { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@saas-skeleton/ui/components/ui/sheet';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@saas-skeleton/ui/components/ui/toggle-group';
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
  const { mutate: markAllRead } = useNotificationsMarkAllRead({
    mutation: { onSuccess: invalidate },
  });
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
    <Sheet
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) {
          setShowSettings(false);
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle>{showSettings ? t('settings.title') : t('title')}</SheetTitle>
          {!showSettings && (
            <div className="mt-3 flex items-center gap-1">
              {/* ToggleGroup замість трьох кнопок із ручним variant: вибраний стан
                  тримає сам компонент і віддає його в aria-pressed */}
              <ToggleGroup
                value={[filter]}
                onValueChange={(next) => {
                  // multiple=false (дефолт) — у масиві максимум один елемент; порожній
                  // означає повторний клік по активному фільтру: лишаємо як є.
                  // Каст — бо обгортка реєстру не generic (звужує Value до string),
                  // а значення сюди приходять рівно з FILTERS
                  const [value] = next as NotificationsFindAllFilter[];
                  if (value) {
                    setFilter(value);
                  }
                }}
              >
                {FILTERS.map((value) => (
                  <ToggleGroupItem key={value} value={value} size="sm">
                    {t(`filter.${value}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Button
                size="icon-sm"
                variant="ghost"
                className="ml-auto"
                aria-label={t('settings.open')}
                onClick={() => {
                  setShowSettings(true);
                }}
              >
                <Settings />
              </Button>
            </div>
          )}
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-4 pb-4">
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
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyTitle className="text-destructive">{t('loadError')}</EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                )}
                {!isInitialLoading && !isError && entries.length === 0 && (
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyDescription>{t(`empty.${filter}`)}</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
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
          </div>
        </ScrollArea>

        {!showSettings && (
          <SheetFooter className="flex-row gap-2">
            <Button
              className="flex-1"
              variant="secondary"
              onClick={() => {
                markAllRead(undefined);
              }}
            >
              {t('markAllRead')}
            </Button>
            {nextCursor && (
              <Button
                className="flex-1"
                variant="secondary"
                disabled={isFetching}
                onClick={() => {
                  setCursor(nextCursor);
                }}
              >
                {t('loadMore')}
              </Button>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
