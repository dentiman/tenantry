/**
 * Конфігурація Postgres FTS за мовою документа (AI-2a.4, design.md D1). Українського
 * stemmer-а Postgres не має: `simple` дає лексеми без стемінгу, а не чужий стемінг.
 * Закритий список — значення йде в SQL як `regconfig`, а не довільний рядок.
 */
const FTS_CONFIGS: Readonly<Record<string, 'english' | 'russian'>> = {
  en: 'english',
  ru: 'russian',
};

export type FtsConfig = 'english' | 'russian' | 'simple';

export function ftsConfigFor(language: string): FtsConfig {
  return FTS_CONFIGS[language] ?? 'simple';
}

/** Усі конфігурації, з якими можуть бути проіндексовані чанки — для запиту */
export const FTS_CONFIG_LIST: readonly FtsConfig[] = ['english', 'russian', 'simple'];
