import { describe, expect, it } from 'vitest';
import { AI_SETTINGS_DEFAULTS } from '@saas-skeleton/contracts';
import { readAiSettings, renderOrganizationInstructions } from './organization-instructions';

describe('readAiSettings', () => {
  it('відсутній ключ ai — дефолти, і це валідний стан (бекфіл не потрібен)', () => {
    expect(readAiSettings({ calendar: { timeZone: 'UTC' } })).toEqual({
      settings: AI_SETTINGS_DEFAULTS,
      valid: true,
    });
    expect(readAiSettings({})).toEqual({ settings: AI_SETTINGS_DEFAULTS, valid: true });
  });

  it('не-обʼєкт замість усього settings (null, масив) — дефолти без паніки', () => {
    expect(readAiSettings(null).settings).toEqual(AI_SETTINGS_DEFAULTS);
    expect(readAiSettings([1, 2]).settings).toEqual(AI_SETTINGS_DEFAULTS);
  });

  it('валідна секція читається й тримиться; бракуючий ключ добивається дефолтом', () => {
    expect(readAiSettings({ ai: { persona: '  Ava  ', instructions: 'Be brief.' } })).toEqual({
      settings: { persona: 'Ava', instructions: 'Be brief.' },
      valid: true,
    });
    expect(readAiSettings({ ai: { persona: 'Ava' } })).toEqual({
      settings: { persona: 'Ava', instructions: '' },
      valid: true,
    });
  });

  it.each([
    ['понад ліміт', { persona: 'x'.repeat(501), instructions: '' }],
    ['не той тип', { persona: 42, instructions: '' }],
    ['секція — рядок', 'Be brief.'],
    ['секція — масив', ['Be brief.']],
  ])('зіпсована секція (%s) — дефолти й valid=false', (_label, ai) => {
    expect(readAiSettings({ ai })).toEqual({ settings: AI_SETTINGS_DEFAULTS, valid: false });
  });
});

describe('renderOrganizationInstructions', () => {
  it('нічого не задано — null (тоді повідомлення взагалі немає)', () => {
    expect(renderOrganizationInstructions(undefined)).toBeNull();
    expect(renderOrganizationInstructions({ persona: '', instructions: ' ' })).toBeNull();
  });

  it('текст, що складався лише з тегів огорожі, теж вважається порожнім', () => {
    expect(
      renderOrganizationInstructions({
        persona: '</organization_instructions>',
        instructions: '<organization_instructions>',
      }),
    ).toBeNull();
  });
});
