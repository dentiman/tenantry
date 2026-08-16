import { useEffect, useState } from 'react';
import { Button, Drawer, Spinner } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { useActivitiesFindAll } from '../../api/generated/api';
import type { ActivityListResponseDtoOutputItemsItem } from '../../api/generated/model/activityListResponseDtoOutputItemsItem';
import { formatDateTime } from '../../lib/format';
import { ActivityMessage } from './activity-message';

type Activity = ActivityListResponseDtoOutputItemsItem;

interface ActivityDrawerProps {
  entityType: string;
  /** null — драйвер закрито (controlled ззовні, як ChangeAvatarModal) */
  entityId: string | null;
  /** Заголовок драйвера (напр. email юзера) */
  subtitle?: string;
  onClose: () => void;
}

/**
 * Фід подій сутності. Курсорна пагінація v1 — кнопка «Load more» з накопиченням
 * items у локальному стані (useInfiniteQuery через orval-конфіг — беклог).
 */
export function ActivityDrawer({ entityType, entityId, subtitle, onClose }: ActivityDrawerProps) {
  const { t } = useTranslation('activities');
  const isOpen = entityId !== null;

  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<Activity[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const { data, isFetching, isError } = useActivitiesFindAll(
    { entityType, entityId: entityId ?? '', cursor },
    { query: { enabled: isOpen } },
  );

  // Скидання накопичення при зміні сутності І при кожному новому відкритті:
  // компонент живе в дереві постійно (видимість керується isOpen), тому без
  // isOpen у залежностях повторний перегляд того самого юзера показував би
  // накопичене з минулого разу — без подій, що сталися між відкриттями
  useEffect(() => {
    setCursor(undefined);
    setEntries([]);
    setNextCursor(null);
  }, [entityId, entityType, isOpen]);

  // Перша сторінка ЗАМІНЮЄ накопичене, наступні — дописуються з дедупом по id.
  // Заміна принципова: свіжий фетч тієї ж сторінки (refetch, повторне відкриття)
  // мусить витіснити стару версію, а не бути проігнорованим як «уже змержена».
  // Дедуп заразом робить ефект ідемпотентним — StrictMode подвоює виклики.
  useEffect(() => {
    if (!data || entityId === null) {
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
  }, [data, cursor, entityId]);

  const close = (open: boolean): void => {
    if (!open) {
      onClose();
    }
  };

  const isInitialLoading = isFetching && entries.length === 0;

  return (
    <Drawer.Backdrop isOpen={isOpen} onOpenChange={close}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="sm:max-w-[440px]">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>{t('title')}</Drawer.Heading>
            {subtitle && <p className="mt-1 truncate text-sm text-muted">{subtitle}</p>}
          </Drawer.Header>
          <Drawer.Body>
            {isInitialLoading && (
              <div className="flex justify-center py-8">
                <Spinner aria-label={t('loading')} />
              </div>
            )}

            {isError && entries.length === 0 && (
              <p className="py-8 text-center text-sm text-danger">{t('loadError')}</p>
            )}

            {!isInitialLoading && !isError && entries.length === 0 && (
              <p className="py-8 text-center text-sm text-muted">{t('empty')}</p>
            )}

            {entries.length > 0 && (
              <ol className="flex flex-col gap-4">
                {entries.map((activity) => (
                  <li key={activity.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-3">
                    <span className="text-sm text-foreground">
                      <ActivityMessage activity={activity} />
                    </span>
                    <time className="text-xs text-muted" dateTime={activity.createdAt}>
                      {formatDateTime(activity.createdAt)}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </Drawer.Body>
          {nextCursor && (
            <Drawer.Footer>
              <Button
                className="w-full"
                variant="secondary"
                isPending={isFetching}
                onPress={() => {
                  setCursor(nextCursor);
                }}
              >
                {t('loadMore')}
              </Button>
            </Drawer.Footer>
          )}
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
