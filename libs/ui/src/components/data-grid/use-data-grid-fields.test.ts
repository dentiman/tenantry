import { describe, expect, it } from 'vitest';
import { reduceFieldsState } from './field-model';
import type { FieldMeta } from './field-model';
import { fieldsStorageKey, readFieldsState, writeFieldsState } from './use-data-grid-fields';
import type { DataGridFieldsStorage } from './use-data-grid-fields';
import { CUSTOM_FIELD_SET_ID } from './types';

const fields: FieldMeta[] = [{ id: 'name', hideable: false }, { id: 'phone' }, { id: 'tags' }];
const key = fieldsStorageKey('tenant.test');

function memoryStorage(): DataGridFieldsStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    read: (k) => store.get(k) ?? null,
    write: (k, v) => {
      store.set(k, v);
    },
  };
}

const throwingStorage: DataGridFieldsStorage = {
  read: () => {
    throw new Error('SecurityError');
  },
  write: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('fields state storage', () => {
  it('ключ розводить гріди за gridId', () => {
    expect(fieldsStorageKey('tenant.users')).not.toBe(fieldsStorageKey('tenant.customers'));
  });

  it('round-trip: записаний Custom читається назад', () => {
    const storage = memoryStorage();
    const state = {
      activeSetId: CUSTOM_FIELD_SET_ID,
      preset: null,
      custom: { phone: false, tags: true },
    };
    writeFieldsState(storage, key, state);
    expect(readFieldsState(storage, key, fields)).toEqual(state);
  });

  it('битий JSON → початковий стан', () => {
    const storage = memoryStorage();
    storage.store.set(key, '{not json');
    expect(readFieldsState(storage, key, fields).activeSetId).toBeNull();
  });

  it('заблоковане сховище: читання дає початковий стан, запис не кидає, toggle працює in-memory', () => {
    const state = readFieldsState(throwingStorage, key, fields);
    const next = reduceFieldsState(
      state,
      { type: 'toggle', fieldId: 'phone', visible: false },
      fields,
    );
    expect(() => {
      writeFieldsState(throwingStorage, key, next);
    }).not.toThrow();
    expect(next.activeSetId).toBe(CUSTOM_FIELD_SET_ID);
  });
});
