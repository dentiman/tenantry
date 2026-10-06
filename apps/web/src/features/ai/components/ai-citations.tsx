import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileTextIcon } from 'lucide-react';
import type { AiCitation } from '@saas-skeleton/contracts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@saas-skeleton/ui/components/ui/dialog';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { useAiCitation } from '../../../api/generated/api';
import { Markdown } from './markdown';

/**
 * Джерела відповіді асистента (AI-2a.3). Список приходить уже перевіреним сервером —
 * лише фрагменти, які модель справді отримала й на які посилається `[n]`. Текст
 * фрагмента НЕ лежить у стрічці: діалог тягне його окремим запитом, і сервер щоразу
 * заново перевіряє, чи фрагмент досі опублікований і видимий ролі (design.md D8).
 */
export function AiCitations({
  messageId,
  citations,
}: {
  messageId: string;
  citations: readonly AiCitation[];
}) {
  const { t } = useTranslation('ai');
  const [open, setOpen] = useState<AiCitation | null>(null);

  if (citations.length === 0) {
    return null;
  }

  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-muted-foreground">{t('citations.title')}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {citations.map((citation) => (
          <li key={citation.n}>
            <button
              type="button"
              className="flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => {
                setOpen(citation);
              }}
            >
              <span className="shrink-0 font-medium tabular-nums">[{citation.n}]</span>
              <FileTextIcon className="mt-px size-3.5 shrink-0 text-icon-muted" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate">{citation.title}</span>
                <span className="block truncate text-muted-foreground">{citation.heading}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Dialog
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) {
            setOpen(null);
          }
        }}
      >
        {open && <CitationDialogContent messageId={messageId} citation={open} />}
      </Dialog>
    </div>
  );
}

function CitationDialogContent({
  messageId,
  citation,
}: {
  messageId: string;
  citation: AiCitation;
}) {
  const { t } = useTranslation('ai');
  // 404 — нормальний стан (фрагмент зняли з публікації чи змінили роль), не глобальна
  // помилка: показуємо в самому діалозі й не ретраїмо
  const { data, isPending, isError } = useAiCitation(messageId, citation.n, {
    query: { retry: false, staleTime: 60_000 },
  });

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>
          [{citation.n}] {citation.title}
        </DialogTitle>
        <DialogDescription>
          {citation.heading}
          <span className="block font-mono text-xs">{citation.path}</span>
        </DialogDescription>
      </DialogHeader>
      {isPending ? (
        <p className="text-sm text-muted-foreground">{t('citations.loading')}</p>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">{t('citations.unavailable')}</p>
      ) : (
        <ScrollArea className="max-h-[60vh]">
          <Markdown className="pr-3">{data.content}</Markdown>
        </ScrollArea>
      )}
    </DialogContent>
  );
}
