import { useEffect, useLayoutEffect } from 'react';
import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { syncFieldSets, validateFieldSets } from './field-model';
import type { DataGridFieldsModel } from './use-data-grid-fields';
import { CUSTOM_FIELD_SET_ID } from './types';
import type { DataGridFieldSet } from './types';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@saas-skeleton/ui/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@saas-skeleton/ui/components/ui/tooltip';

/**
 * Шестерня з меню полів. Нічого не знає ні про своє місце на екрані, ні про набори
 * полів — лише емітить toggle у модель Root. Тому однаково працює в хедері колонки
 * дій, у тулбарі чи в хедері сторінки, з `Grid.FieldSets` і без нього.
 */
export function DataGridFieldSettings<TItem>({
  model,
  className,
}: {
  model: DataGridFieldsModel<TItem>;
  className?: string;
}) {
  const { t } = useTranslation('common');
  const hideable = model.fields.filter(model.isHideable);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
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
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('fields.heading')}</DropdownMenuLabel>
          {hideable.map((field) => {
            const isVisible = model.visibleIds.has(field.id);
            return (
              // closeOnClick у CheckboxItem за замовчуванням false — кілька
              // перемикань за одне відкриття меню
              <DropdownMenuCheckboxItem
                key={field.id}
                checked={isVisible}
                disabled={isVisible && !model.canHide(field.id)}
                onCheckedChange={(checked) => {
                  model.dispatch({ type: 'toggle', fieldId: field.id, visible: checked });
                }}
              >
                {field.header}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              model.dispatch({ type: 'reset' });
            }}
          >
            {t('fields.reset')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
