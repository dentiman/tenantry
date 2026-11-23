import { Suspense, type ReactNode } from 'react';
import { CatchBoundary, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@saas-skeleton/ui/components/ui/empty';
import { Skeleton } from '@saas-skeleton/ui/components/ui/skeleton';
import { isChunkLoadError } from '@saas-skeleton/ui/lib/lazy';
import { reportError } from '@saas-skeleton/ui/lib/report-error';

/**
 * Запасні екрани ледачого завантаження — спільні для обох фронтів, підключаються ОДИН раз у
 * `createRouter` (`defaultPendingComponent` / `defaultErrorComponent`), а не на кожному роуті
 * (docs/frontend/lazy-loading.md).
 *
 * Обидва рендеряться ВСЕРЕДИНІ outlet-а батька, тож шел (рейл, панель area, хедер, скляний фон
 * `staticData.backdrop`) лишається на місці — міняється лише область контенту. Тому й фон
 * у них прозорий: суцільна заливка зламала б скляний шел `/guide`.
 */

/**
 * Скелет області контенту. Показується роутером лише коли чанк/loader не встиг за `pendingMs`
 * (`defaultPendingMs` у роутері) і тримається не менше `pendingMinMs` — швидкі переходи
 * його не бачать, тож мигання немає.
 */
export function RoutePending() {
  const { t } = useTranslation('common');
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4 p-1">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** Скелет колонки/панелі (друга колонка area) на час завантаження її чанка */
export function PanelPending() {
  const { t } = useTranslation('common');
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-2 p-3">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-2/3" />
    </div>
  );
}

/**
 * Помилка маршруту. Дві різні історії:
 * - провал завантаження чанка (обрив мережі або свіжий деплой, що прибрав старий файл):
 *   повторювати немає сенсу — `import()` кешує невдачу, тож лишається повне перезавантаження;
 * - будь-яка інша помилка рендера/loader-а: «спробувати ще раз» скидає межу й перераховує роути.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation('common');
  const router = useRouter();
  const isChunkError = isChunkLoadError(error);

  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon />
        </EmptyMedia>
        <EmptyTitle className="text-lg">
          {isChunkError ? t('routeError.chunkTitle') : t('routeError.title')}
        </EmptyTitle>
        <EmptyDescription>
          {isChunkError ? t('routeError.chunkDescription') : t('routeError.description')}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {isChunkError ? (
          <Button
            onClick={() => {
              window.location.reload();
            }}
          >
            {t('routeError.reload')}
          </Button>
        ) : (
          <Button
            onClick={() => {
              reset();
              void router.invalidate();
            }}
          >
            {t('routeError.retry')}
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}

/**
 * Межа для `lazyComponent` усередині сторінки, слота чи панелі: `Suspense` на час завантаження
 * чанка + перехоплення помилки (інакше провал чанка валив би весь екран до найближчої межі
 * роута).
 *
 * Свідоме рішення: помилку в слоті не показуємо екраном — внесок просто зникає, решта сторінки
 * працює (віджет дашборда не має права покласти дашборд). Тому ТИХОЮ ця межа бути не може:
 * кожна перехоплена помилка йде в `reportError` (`libs/ui/src/lib/report-error.ts` — туди ж
 * підключається Sentry), а провал чанка позначений в контексті, щоб його можна було відфільтрувати
 * від справжніх багів.
 */
export function LazyBoundary({
  children,
  fallback = null,
  name,
}: {
  children: ReactNode;
  fallback?: ReactNode;
  /** Хто саме (id внеску слота, імʼя панелі) — потрапляє в контекст звіту */
  name?: string;
}) {
  return (
    <CatchBoundary
      getResetKey={() => 'lazy-boundary'}
      errorComponent={() => null}
      onCatch={(error) => {
        reportError({
          error,
          source: 'lazy-boundary',
          context: { name, isChunkLoadError: isChunkLoadError(error) },
        });
      }}
    >
      <Suspense fallback={fallback}>{children}</Suspense>
    </CatchBoundary>
  );
}
