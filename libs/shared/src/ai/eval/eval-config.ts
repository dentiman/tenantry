import { z } from 'zod';
import type { KnowledgeSearchMode } from '../knowledge/postgres-knowledge-source';

/**
 * Файл конфігурацій eval відповідей (AI-5c, design.md D2): іменовані набори параметрів
 * якості. Не задане поле береться з чинних налаштувань — модель з UI суперадміна поверх env,
 * решта з env (`AI_MAX_OUTPUT_TOKENS`, `AI_HISTORY_TURNS`, `AI_DOCS_*`), як у воркера.
 * Провайдер, URL і ключ конфігурація не змінює — лише модель.
 */
export const EvalConfigEntrySchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{0,39}$/, 'lowercase letters, digits, ".", "_", "-"'),
    description: z.string().optional(),
    model: z.string().trim().min(1).optional(),
    maxOutputTokens: z.number().int().min(1).max(32_000).optional(),
    finalChunks: z.number().int().min(1).max(20).optional(),
    maxContextTokens: z.number().int().min(1).max(20_000).optional(),
    historyTurns: z.number().int().min(0).max(50).optional(),
    searchMode: z.enum(['vector', 'fts', 'hybrid']).optional(),
    /** `null` — без порогу; відсутнє поле — з налаштувань */
    maxDistance: z.number().gt(0).max(2).nullable().optional(),
  })
  .strict();
export type EvalConfigEntry = z.infer<typeof EvalConfigEntrySchema>;

export const EvalConfigFileSchema = z
  .object({
    description: z.string().optional(),
    configs: z.array(EvalConfigEntrySchema).min(1),
  })
  .strict()
  .refine((file) => new Set(file.configs.map((c) => c.name)).size === file.configs.length, {
    message: 'configuration names must be unique',
  });
export type EvalConfigFile = z.infer<typeof EvalConfigFileSchema>;

/** Чинні значення — те, з чим зараз відповідає прод */
export interface EvalDefaults {
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly historyTurns: number;
  readonly finalChunks: number;
  readonly maxContextTokens: number;
  readonly searchMode: KnowledgeSearchMode;
  readonly maxDistance: number | null;
}

type Field = keyof EvalDefaults;

export interface ResolvedEvalConfig extends EvalDefaults {
  readonly name: string;
  readonly description?: string;
  /** Які поля задав файл; решта — з налаштувань (для звіту) */
  readonly overridden: readonly Field[];
}

const FIELDS: readonly Field[] = [
  'model',
  'maxOutputTokens',
  'historyTurns',
  'finalChunks',
  'maxContextTokens',
  'searchMode',
  'maxDistance',
];

export function resolveEvalConfigs(
  file: EvalConfigFile,
  defaults: EvalDefaults,
): ResolvedEvalConfig[] {
  return file.configs.map((entry) => {
    const overridden = FIELDS.filter((field) => entry[field] !== undefined);
    return {
      name: entry.name,
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      model: entry.model ?? defaults.model,
      maxOutputTokens: entry.maxOutputTokens ?? defaults.maxOutputTokens,
      historyTurns: entry.historyTurns ?? defaults.historyTurns,
      finalChunks: entry.finalChunks ?? defaults.finalChunks,
      maxContextTokens: entry.maxContextTokens ?? defaults.maxContextTokens,
      searchMode: entry.searchMode ?? defaults.searchMode,
      maxDistance: entry.maxDistance !== undefined ? entry.maxDistance : defaults.maxDistance,
      overridden,
    };
  });
}

/** Ключ кешу retrieval: однакові параметри пошуку дають той самий вибір фрагментів */
export function retrievalKey(
  config: Pick<
    ResolvedEvalConfig,
    'searchMode' | 'maxDistance' | 'finalChunks' | 'maxContextTokens'
  >,
): string {
  return [
    config.searchMode,
    config.maxDistance === null ? 'none' : String(config.maxDistance),
    String(config.finalChunks),
    String(config.maxContextTokens),
  ].join('|');
}
