import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canHideField,
  isHideable,
  reduceFieldsState,
  resolveVisibility,
  sanitizeStoredFieldsState,
  serializeFieldsState,
} from './field-model';
import type { FieldMeta, FieldsAction } from './field-model';
import type { DataGridField, DataGridFieldsState } from './types';

/**
 * Шов для сховища: зараз localStorage, пізніше — можливо per-user API без змін гріда.
 * Навмисно не експортується з барелю, доки другого адаптера немає.
 */
export interface DataGridFieldsStorage {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
}

export const localStorageFieldsStorage: DataGridFieldsStorage = {
  read: (key) => window.localStorage.getItem(key),
  write: (key, value) => {
    window.localStorage.setItem(key, value);
  },
};

export function fieldsStorageKey(gridId: string): string {
  return `saas-skeleton:data-grid:${gridId}:fields`;
}

/**
 * Читання недовіреного збереженого стану. Будь-який збій (приватний режим, заблоковане
 * сховище, битий JSON) — початковий стан: вибір полів — зручність, не причина ламати список.
 */
export function readFieldsState(
  storage: DataGridFieldsStorage,
  key: string,
  fields: readonly FieldMeta[],
): DataGridFieldsState {
  let raw: unknown = null;
  try {
    const stored = storage.read(key);
    raw = stored === null ? null : JSON.parse(stored);
  } catch {
    raw = null;
  }
  return sanitizeStoredFieldsState(raw, fields);
}

/** Запис мовчки ковтає збій — стан у памʼяті лишається робочим до кінця сесії */
export function writeFieldsState(
  storage: DataGridFieldsStorage,
  key: string,
  state: DataGridFieldsState,
): void {
  try {
    storage.write(key, serializeFieldsState(state));
  } catch {
    // сховище недоступне — працюємо in-memory
  }
}

/**
 * Модель полів гріда в контексті Root. Про пресети не знає: `applyPreset` викликає
 * `Grid.FieldSets`, `toggle` — меню полів, рендерери читають `visibleFields`.
 */
export interface DataGridFieldsModel<TItem> {
  /** Усі оголошені поля (порядок декларації) — для меню полів */
  fields: DataGridField<TItem>[];
  /** Видимі поля в порядку декларації — для рендерера (таблиці, карток) */
  visibleFields: DataGridField<TItem>[];
  visibleIds: ReadonlySet<string>;
  state: DataGridFieldsState;
  dispatch: (action: FieldsAction) => void;
  isHideable: (field: DataGridField<TItem>) => boolean;
  canHide: (fieldId: string) => boolean;
}

interface UseDataGridFieldsOptions<TItem> {
  fields: DataGridField<TItem>[];
  /** Без gridId — стан лише в памʼяті (нема чим ключувати сховище) */
  gridId?: string;
  storage?: DataGridFieldsStorage;
}

export function useDataGridFields<TItem>({
  fields,
  gridId,
  storage = localStorageFieldsStorage,
}: UseDataGridFieldsOptions<TItem>): DataGridFieldsModel<TItem> {
  // Поля приходять щорендера новим масивом (cell-замикання) — мемо залежить від
  // рядкового ключа id/прапорців, а не від ідентичності масиву
  const metaKey = JSON.stringify(
    fields.map((field) => [field.id, field.hideable ?? true, field.defaultHidden ?? false]),
  );
  const meta = useMemo<FieldMeta[]>(
    () => fields.map(({ id, hideable, defaultHidden }) => ({ id, hideable, defaultHidden })),
    [metaKey],
  );
  const storageKey = gridId === undefined ? undefined : fieldsStorageKey(gridId);

  const [state, setState] = useState<DataGridFieldsState>(() =>
    storageKey === undefined
      ? sanitizeStoredFieldsState(null, meta)
      : readFieldsState(storage, storageKey, meta),
  );

  // Пишемо лише після реальної зміни: стартовий стан уже або в сховищі, або початковий
  const isFirstStateRef = useRef(true);
  useEffect(() => {
    if (isFirstStateRef.current) {
      isFirstStateRef.current = false;
      return;
    }
    if (storageKey !== undefined) {
      writeFieldsState(storage, storageKey, state);
    }
  }, [state, storage, storageKey]);

  const dispatch = useCallback(
    (action: FieldsAction) => {
      setState((prev) => reduceFieldsState(prev, action, meta));
    },
    [meta],
  );

  const visibleIds = useMemo(() => resolveVisibility(meta, state), [meta, state]);

  return {
    fields,
    visibleFields: fields.filter((field) => visibleIds.has(field.id)),
    visibleIds,
    state,
    dispatch,
    isHideable,
    canHide: (fieldId) => canHideField(visibleIds, fieldId),
  };
}
