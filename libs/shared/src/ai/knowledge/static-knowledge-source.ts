import bundledCorpus from './generated/knowledge-corpus.json';
import { parseKnowledgeCorpus, type KnowledgeCorpus } from './corpus-builder';
import type { KnowledgeQuery, KnowledgeSelection, KnowledgeSource } from './knowledge-source';

/**
 * Корпус рівня 1 із закоміченого артефакту (`pnpm ai:knowledge`), без жодного читання
 * `.md` з диска в рантаймі (docs/ai-assistant.md §7.2).
 *
 * Фільтр `audience`: документи адміна не потрапляють у промпт не-ADMIN — і бюджет, і
 * поведінка («не розповідай USER-у, як робити те, чого він не збереже»). Обидва
 * погляди мають ОДНУ версію: версія ідентифікує корпус, а набір документів — функція
 * версії й ролі (design.md D2).
 */
export class StaticKnowledgeSource implements KnowledgeSource {
  private readonly version: string;
  private readonly all: KnowledgeSelection['documents'];
  private readonly everyone: KnowledgeSelection['documents'];

  /** Форма й версія перевіряються ТУТ, на старті воркера, а не на кожній відповіді */
  constructor(corpus: unknown = bundledCorpus) {
    const parsed: KnowledgeCorpus = parseKnowledgeCorpus(corpus);
    this.version = parsed.version;
    this.all = parsed.documents.map(({ slug, title, body }) => ({ slug, title, body }));
    this.everyone = parsed.documents
      .filter((doc) => doc.audience === 'all')
      .map(({ slug, title, body }) => ({ slug, title, body }));
  }

  select(query: KnowledgeQuery): Promise<KnowledgeSelection> {
    return Promise.resolve({
      version: this.version,
      documents: query.role === 'ADMIN' ? this.all : this.everyone,
    });
  }
}
