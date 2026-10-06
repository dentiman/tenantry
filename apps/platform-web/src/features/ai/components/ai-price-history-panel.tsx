import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ContextPanelHeader,
  ContextPanelPortal,
} from '@saas-skeleton/ui/components/context-panel-slot';
import { DateTimeCell } from '@saas-skeleton/ui/components/date-time-cell';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { useAiCostsPriceHistory } from '../../../api/generated/api';
import type { AiModelPriceListResponseDtoOutputItemsItem } from '../../../api/generated/model/aiModelPriceListResponseDtoOutputItemsItem';
import { formatPrice, formatTokens } from '../../../lib/money';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm text-foreground tabular-nums">{children}</span>
    </div>
  );
}

/**
 * Історія ціни моделі (AI-5b, design.md R6): кожна зміна — окремий рядок, новіші зверху.
 * Та сама метрика контекстної панелі, що `JobDetailsPanel` (`p-2`, `ScrollArea`).
 */
export function AiPriceHistoryPanel({
  price,
  onClose,
}: {
  price: AiModelPriceListResponseDtoOutputItemsItem | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('ai');
  const history = useAiCostsPriceHistory(
    { provider: price?.provider ?? '', model: price?.model ?? '' },
    { query: { enabled: price !== null } },
  );

  if (!price) {
    return null;
  }

  return (
    <ContextPanelPortal contentKey={price.id} label="AiPriceHistoryPanel">
      <ContextPanelHeader
        title={price.model}
        description={`${t('prices.history')} · ${price.provider}`}
        onClose={onClose}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-2">
          {history.isPending ? (
            <Spinner />
          ) : (history.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">{t('prices.historyEmpty')}</p>
          ) : (
            history.data?.items.map((row) => (
              <div key={row.id} className="rounded-md border border-border p-2">
                <div className="flex items-center justify-between gap-2 pb-1">
                  <DateTimeCell value={row.validFrom} />
                  <Badge variant={row.source === 'manual' ? 'warning' : 'secondary'}>
                    {t(`prices.sources.${row.source}`)}
                  </Badge>
                </div>
                <Fact label={t('prices.input')}>{formatPrice(row.inputPerMillion)}</Fact>
                <Fact label={t('prices.output')}>{formatPrice(row.outputPerMillion)}</Fact>
                <Fact label={t('prices.cacheRead')}>
                  {row.cacheReadPerMillion !== null ? formatPrice(row.cacheReadPerMillion) : '—'}
                </Fact>
                <Fact label={t('prices.cacheWrite')}>
                  {row.cacheWritePerMillion !== null ? formatPrice(row.cacheWritePerMillion) : '—'}
                </Fact>
                <Fact label={t('prices.request')}>{formatPrice(row.requestPrice)}</Fact>
                {(row.tiers ?? []).map((tier) => (
                  <Fact
                    key={tier.minPromptTokens}
                    label={t('prices.tierFrom', { tokens: formatTokens(tier.minPromptTokens) })}
                  >
                    <span className="whitespace-nowrap">
                      {[tier.inputPerMillion, tier.outputPerMillion]
                        .map((value) => (value !== undefined ? formatPrice(value) : '—'))
                        .join(' · ')}
                    </span>
                  </Fact>
                ))}
                {row.createdBy && <Fact label={t('prices.createdBy')}>{row.createdBy}</Fact>}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </ContextPanelPortal>
  );
}
