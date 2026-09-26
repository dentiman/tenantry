import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { GripVertical, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useSortableReorder } from '../../hooks/use-sortable-reorder';
import {
  filterFieldsByQuery,
  shouldShowFieldSearch,
  stepMoveTarget,
  syncFieldSets,
  validateFieldSets,
} from './field-model';
import type { DataGridFieldsModel } from './use-data-grid-fields';
import { CUSTOM_FIELD_SET_ID } from './types';
import type { DataGridField, DataGridFieldSet } from './types';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Checkbox } from '@saas-skeleton/ui/components/ui/checkbox';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@saas-skeleton/ui/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@saas-skeleton/ui/components/ui/popover';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@saas-skeleton/ui/components/ui/tooltip';

/**
 * Шестерня з панеллю полів. Нічого не знає ні про своє місце на екрані, ні про набори
 * полів — лише емітить toggle/move у модель Root. Тому однаково працює в хедері колонки
 * дій, у тулбарі чи в хедері сторінки, з `Grid.FieldSets` і без нього.
 *
 * Popover, а не DropdownMenu: меню — це список КОМАНД, і Base UI Menu володіє roving
 * focus, typeahead та активацією пунктів — це б’ється з ручкою перетягування
 * (pointerdown на ручці активував би пункт, стрілки забирала б навігація меню).
 * Панель із чекбоксами й ручками — рівно те, що Notion показує для цієї задачі.
 *
 * Дві секції (як у Notion): Shown — у порядку показу, з ручками; Hidden — у порядку
 * декларації, без ручок. Тягнути приховане — переставляти те, чого не видно.
 *
 * Висота панелі обмежена (не більше за місце у вікні і 32rem): заголовки секцій і Reset
 * стоять на місці, прокручуються лише списки. Коли полів більше за поріг
 * (`FIELD_SEARCH_THRESHOLD`), у заголовку секції Hidden — в один рядок із ним — зʼявляється
 * пошук за підписом або id поля, а кількість прихованих стає правою частиною цього поля.
 * Пошук стосується ЛИШЕ прихованих: показаних рівно стільки, скільки колонок у таблиці,
 * їх видно й так, а шукають саме те, що додати. Тому ручки показаних під час пошуку лишаються.
 *
 * Розкладка секцій: `list` — одна під одною (вузька панель, один скрол); `split` — дві
 * колонки поруч, ліворуч Shown, праворуч Hidden, кожна зі своїм скролом (як «Edit columns»
 * у HubSpot/Salesforce: вибране й доступне видно одночасно). `auto` — split, коли полів
 * стільки, що зʼявляється пошук, інакше list: для 7 полів широка панель — зайве.
 */
export type DataGridFieldSettingsLayout = 'auto' | 'list' | 'split';

export function DataGridFieldSettings<TItem>({
  model,
  layout = 'auto',
  className,
}: {
  model: DataGridFieldsModel<TItem>;
  layout?: DataGridFieldSettingsLayout;
  className?: string;
}) {
  const { t } = useTranslation('common');
  const { dispatch, displayFields, visibleIds } = model;
  const displayIds = displayFields.map((field) => field.id);
  const pinnedIds = displayFields.filter(model.isPinned).map((field) => field.id);
  const hidden = model.fields.filter((field) => !visibleIds.has(field.id));
  const [announcement, setAnnouncement] = useState('');
  const [query, setQuery] = useState('');
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const hasSearch = shouldShowFieldSearch(model.fields.length);
  const isFiltering = hasSearch && query.trim() !== '';
  const hiddenRows = isFiltering ? filterFieldsByQuery(hidden, query) : hidden;
  const isSplit = layout === 'split' || (layout === 'auto' && hasSearch);

  // Live: рядки переставляються під рукою, таблиця — разом із ними (одна колонка за крок)
  const { drag, itemRef, handleProps } = useSortableReorder({
    axis: 'y',
    ids: displayIds,
    lockedIds: pinnedIds,
    mode: 'live',
    onMove: (fieldId, beforeId) => {
      dispatch({ type: 'move', fieldId, beforeId });
    },
    // Список прокручується — біля країв під час перетягування він прокручується сам
    scrollContainer: () => listRef.current,
  });

  const moveByKeyboard = (field: DataGridField<TItem>, delta: -1 | 1): void => {
    const target = stepMoveTarget(displayIds, field.id, delta, model.fields);
    if (!target) {
      return;
    }
    dispatch({ type: 'move', fieldId: field.id, beforeId: target.beforeId });
    const without = displayIds.filter((id) => id !== field.id);
    const position =
      (target.beforeId === null ? without.length : without.indexOf(target.beforeId)) + 1;
    setAnnouncement(t('fields.moved', { label: field.header, position, total: displayIds.length }));
    // Рядок переїжджає в DOM — фокус повертаємо на його ручку явно, бо перенесений
    // вузол браузер може розфокусувати
    requestAnimationFrame(() => {
      handles.current.get(field.id)?.focus();
    });
  };

  const renderRow = (field: DataGridField<TItem>, section: 'shown' | 'hidden') => {
    const isVisible = section === 'shown';
    const isLocked = isVisible && (!model.isHideable(field) || !model.canHide(field.id));
    const canDrag = isVisible && !model.isPinned(field);
    const isDragging = drag?.id === field.id;
    return (
      <li
        key={field.id}
        ref={isVisible ? itemRef(field.id) : undefined}
        className={cn(
          'flex h-8 items-center gap-1 rounded-md pr-1.5 hover:bg-accent',
          isDragging && 'bg-accent shadow-sm ring-1 ring-ring',
        )}
      >
        {canDrag ? (
          <button
            type="button"
            ref={(node) => {
              if (node) {
                handles.current.set(field.id, node);
              } else {
                handles.current.delete(field.id);
              }
            }}
            aria-label={t('fields.reorder', { label: field.header })}
            className="flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                moveByKeyboard(field, event.key === 'ArrowUp' ? -1 : 1);
              }
            }}
            {...handleProps(field.id)}
          >
            <GripVertical className="size-3.5" />
          </button>
        ) : (
          // Місце під ручку тримається й без неї — інакше чекбокси не стояли б в одну вертикаль
          <span aria-hidden className="w-5 shrink-0" />
        )}
        <label className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 has-disabled:cursor-default">
          <Checkbox
            checked={isVisible}
            disabled={isLocked}
            onCheckedChange={(checked) => {
              dispatch({ type: 'toggle', fieldId: field.id, visible: checked });
            }}
          />
          <span className="truncate">{field.header}</span>
        </label>
      </li>
    );
  };

  /**
   * Заголовок секції. У Hidden, коли пошук увімкнено, — в один рядок: назва, поле пошуку,
   * а кількість — правою частиною поля («3 / 25», поки фільтр активний). Висота рядка
   * однакова з пошуком і без (h-9), тож у split-розкладці заголовки колонок на одній лінії.
   */
  const renderSectionHeader = (section: 'shown' | 'hidden') => {
    const label = section === 'shown' ? t('fields.shown') : t('fields.hidden');
    const total = section === 'shown' ? displayFields.length : hidden.length;
    if (section === 'hidden' && hasSearch) {
      return (
        <div className="flex h-9 shrink-0 items-center gap-2 px-2.5">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <InputGroup className="h-7 min-w-0 flex-1">
            <InputGroupInput
              type="search"
              size="sm"
              className="h-full text-sm"
              aria-label={t('fields.search')}
              placeholder={t('fields.searchPlaceholder')}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
            <InputGroupAddon align="inline-end" className="py-0 text-xs tabular-nums">
              {isFiltering ? `${String(hiddenRows.length)} / ${String(total)}` : total}
            </InputGroupAddon>
          </InputGroup>
        </div>
      );
    }
    return (
      <p className="flex h-9 shrink-0 items-center justify-between px-2.5 text-xs font-medium text-muted-foreground">
        {label}
        <span className="tabular-nums">{total}</span>
      </p>
    );
  };

  /** Колонка split-розкладки: заголовок стоїть, прокручується лише список */
  const renderColumn = (
    section: 'shown' | 'hidden',
    rows: DataGridField<TItem>[],
    viewportRef?: RefObject<HTMLDivElement | null>,
  ) => {
    let empty: string | null = null;
    if (rows.length === 0) {
      empty = isFiltering ? t('fields.noMatches') : t('fields.allShown');
    }
    return (
      <div className="flex min-h-0 flex-col">
        {renderSectionHeader(section)}
        <ScrollArea
          className="min-h-0 flex-1"
          viewportRef={viewportRef}
          contentClassName="p-1 pt-0"
        >
          {empty === null ? (
            <ul>{rows.map((field) => renderRow(field, section))}</ul>
          ) : (
            <p className={EMPTY_CLASS}>{empty}</p>
          )}
        </ScrollArea>
      </div>
    );
  };

  return (
    <Popover
      // Пошук скидається після закриття (а не на відкритті) — щоб наступне відкриття
      // не показало на мить старий відфільтрований список
      onOpenChangeComplete={(open: boolean) => {
        if (!open) {
          setQuery('');
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  aria-label={t('fields.settings')}
                  size="icon-sm"
                  variant="ghost"
                  className={className}
                />
              }
            />
          }
        >
          <Settings />
        </TooltipTrigger>
        <TooltipContent>{t('fields.settings')}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        // Не вище за місце у вікні (`--available-height` дає Base UI) і за 32rem: із 30
        // полями панель інакше виходила за екран, а Reset лишався недосяжним
        className={cn(
          'gap-0 p-0',
          // split — ФІКСОВАНА висота, list — максимальна: у split пошук звужує праву
          // колонку, і панель зі стелею стрибала б на кожну літеру (512 → 305 px)
          isSplit
            ? 'h-[min(32rem,var(--available-height))] w-[34rem] max-w-(--available-width)'
            : 'max-h-[min(32rem,var(--available-height))] w-64',
        )}
        aria-label={t('fields.heading')}
        // Фокус НЕ стрибає в пошук: панель частіше відкривають, щоб перемкнути чи
        // переставити поле, ніж щоб шукати. Мишею/дотиком фокус лишається на шестерні;
        // з клавіатури — стандартно, у панель, щоб по ній можна було пройти Tab-ом
        initialFocus={(openType: string) => openType === 'keyboard'}
      >
        {isSplit ? (
          // `grid-rows-[minmax(0,1fr)]`: рядок сітки обмежений висотою панелі, а не
          // вмістом — інакше колонки розпирали б її і скрол не вмикався б
          <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)] divide-x divide-border">
            {renderColumn('shown', displayFields, listRef)}
            {renderColumn('hidden', hiddenRows)}
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1" viewportRef={listRef} contentClassName="p-1">
            {renderSectionHeader('shown')}
            <ul>{displayFields.map((field) => renderRow(field, 'shown'))}</ul>
            {hidden.length > 0 && (
              <>
                {renderSectionHeader('hidden')}
                {hiddenRows.length > 0 ? (
                  <ul>{hiddenRows.map((field) => renderRow(field, 'hidden'))}</ul>
                ) : (
                  <p className={EMPTY_CLASS}>{t('fields.noMatches')}</p>
                )}
              </>
            )}
          </ScrollArea>
        )}
        <div className="border-t border-border p-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start font-normal"
            onClick={() => {
              dispatch({ type: 'reset' });
            }}
          >
            {t('fields.reset')}
          </Button>
        </div>
        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const EMPTY_CLASS = 'px-1.5 py-3 text-center text-sm text-muted-foreground';

/**
 * Таби наборів полів. Пресети — проп САМЕ цього компонента (як `filters` у Toolbar),
 * Root про них не знає: таб записує в Root розвʼязаний список полів.
 *
 * Синхронізація — у layout-ефекті: після маунта (збережений id → склад пресета з
 * коду, невідомий → перший набір) і після Reset (null → перший набір). Встигає до
 * відмальовки, тож рендерер не блимає дефолтами полів. Один FieldSets на Root —
 * стан видимості в Root один.
 *
 * Без TabsContent: таби перемикають режим рендерера, а не володіють панелями.
 */
export function DataGridFieldSets<TItem>({
  model,
  sets,
  className,
}: {
  model: DataGridFieldsModel<TItem>;
  sets: DataGridFieldSet[];
  className?: string;
}) {
  const { t } = useTranslation('common');
  const { state, dispatch, fields } = model;
  const syncAction = syncFieldSets(state, sets);
  const syncKey = syncAction ? JSON.stringify(syncAction) : null;

  useLayoutEffect(() => {
    if (syncAction) {
      dispatch(syncAction);
    }
    // syncKey — рядкова форма syncAction: дія нова щорендера, ключ — ні
  }, [syncKey, dispatch]);

  // Без прапорця збірки — як у page-header-slot: import.meta.env притягнув би
  // типи vite у source-only пакет, а кривий конфіг наборів — баг і в проді
  const configProblems = validateFieldSets(fields, sets).join('\n');
  useEffect(() => {
    if (configProblems) {
      console.warn(`DataGrid field sets:\n${configProblems}`);
    }
  }, [configProblems]);

  if (sets.length === 0) {
    return null;
  }

  const hasCustom = state.custom !== null;
  // До першої синхронізації activeSetId ще null — Base UI Tabs чекає значення, не null
  const value = state.activeSetId ?? sets[0]?.id;

  return (
    <Tabs
      value={value}
      onValueChange={(next: string) => {
        if (next === CUSTOM_FIELD_SET_ID) {
          dispatch({ type: 'selectCustom' });
          return;
        }
        const set = sets.find((candidate) => candidate.id === next);
        if (set) {
          dispatch({ type: 'applyPreset', id: set.id, fields: set.fields });
        }
      }}
      className={className}
    >
      {/* Смуга мінімальна по вертикалі: жолоб без padding, тригер на всю висоту, а
          індикатор активного табу лягає рівно на нижню межу смуги (bottom-[-1px] —
          поверх border-b контейнера), тож таб читається «приклеєним» до таблиці */}
      <TabsList variant="line" size="sm" aria-label={t('fields.sets')} className="p-0">
        {sets.map((set) => (
          <TabsTrigger key={set.id} value={set.id} className={TRIGGER_CLASS}>
            {set.label}
          </TabsTrigger>
        ))}
        {hasCustom && (
          <TabsTrigger value={CUSTOM_FIELD_SET_ID} className={TRIGGER_CLASS}>
            {t('fields.customSet')}
          </TabsTrigger>
        )}
      </TabsList>
    </Tabs>
  );
}

const TRIGGER_CLASS = 'h-full group-data-horizontal/tabs:after:bottom-[-1px]';
