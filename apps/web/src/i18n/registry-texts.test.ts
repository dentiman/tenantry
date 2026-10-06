import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import {
  ACTIVITY_TYPES,
  NOTIFICATION_TYPES,
  activityDefinition,
  notificationDefinition,
  textKeyBase,
} from '@saas-skeleton/contracts';
import { resources } from './namespaces';

/**
 * Тексти типів сповіщень і активностей живуть у неймспейсах модулів-власників
 * (docs/modules.md §7.1), а адресу дає визначення в контрактах. Тут звіряється,
 * що за КОЖНОЮ адресою текст справді є: перенесений чи новий тип без тексту інакше
 * мовчки показав би користувачу сирий ключ.
 */
const i18n = i18next.createInstance();
await i18n.init({ resources, lng: 'en', defaultNS: 'common' });

/** Ключ існує сам або як плюральна форма (`_one`/`_other` для схлопнутих груп) */
function hasText(key: string): boolean {
  return i18n.exists(key) || i18n.exists(key, { count: 2 });
}

describe('тексти типів сповіщень', () => {
  it.each(NOTIFICATION_TYPES)('%s: текст, підпис і категорія', (type) => {
    const definition = notificationDefinition(type);
    expect(definition).toBeDefined();
    if (!definition) return;
    const base = textKeyBase(definition.texts);
    expect(hasText(`${base}type.${type}`)).toBe(true);
    expect(hasText(`${base}label.${type}`)).toBe(true);
    // Категорія — платформна (у notifications) або фічі (у неймспейсі фічі)
    expect(
      hasText(`${base}category.${definition.category}`) ||
        hasText(`notifications:category.${definition.category}`),
    ).toBe(true);
  });
});

describe('тексти типів активностей', () => {
  it.each(ACTIVITY_TYPES)('%s', (type) => {
    const definition = activityDefinition(type);
    expect(definition).toBeDefined();
    if (!definition) return;
    expect(hasText(`${textKeyBase(definition.texts)}${type}`)).toBe(true);
  });

  // Варіанти фрази залежать від payload-а — перелічені явно, разом із payload-ом, що їх дає
  it.each([
    ['customer.owner_changed', { owner: null }],
    ['user.sessions_revoked', { reason: 'user' }],
    ['user.sessions_revoked', { reason: 'revoke_all' }],
    ['user.sessions_revoked', { reason: 'rotation_reuse' }],
  ] as const)('%s → варіант для %o', (type, payload) => {
    const definition = activityDefinition(type);
    const variant = definition?.textVariant?.(payload);
    expect(variant).toBeDefined();
    if (!definition || !variant) return;
    expect(hasText(`${textKeyBase(definition.texts)}${variant}`)).toBe(true);
  });
});
