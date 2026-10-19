import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Mail } from 'lucide-react';
import { ContextPanelHeader } from '@saas-skeleton/ui/components/context-panel-slot';
import { DateTimeCell } from '@saas-skeleton/ui/components/date-time-cell';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { isOverdue, type MockInvoice } from '../data/mock-invoices';
import { formatMonth, Money, Muted, notImplemented } from './invoice-format';
import { InvoiceStatusBadge } from './invoice-status-badge';

/** Секція панелі: підпис дрібним приглушеним, вміст під ним — той самий ритм, що в ContactPanel */
function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Пара «підпис — значення» в один рядок: панель вузька (288px), сітка з двох колонок не влазить */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}

/**
 * Деталі інвойсу в третій колонці шела: шапка, клієнт, суми, позиції, оплата, податкові
 * документи, SAP. Лише читання; кнопки внизу — ті самі заглушки, що й у меню рядка.
 */
export function InvoicePanel({ invoice, onClose }: { invoice: MockInvoice; onClose: () => void }) {
  const { t } = useTranslation('invoices-demo');
  const field = (id: string) => t(`fields.${id}`);
  const method = (value: MockInvoice['paymentMethod']) =>
    value === null ? t('method.none') : t(`method.${value}`);
  const demo = (action: string) => {
    notImplemented(t('demoToast.single', { action, number: invoice.number }), t);
  };
  const inSap = invoice.sapDocEntry !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ContextPanelHeader
        title={<span className="font-mono">{invoice.number}</span>}
        description={t('panel.description', { month: formatMonth(invoice.billedMonth) })}
        onClose={onClose}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <InvoiceStatusBadge status={invoice.status} />
            {isOverdue(invoice) && <Badge variant="warning">{t('overdue')}</Badge>}
            <span className="ml-auto text-lg font-semibold">
              <Money value={invoice.total} />
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                demo(t('actions.downloadPdf'));
              }}
            >
              <Download />
              {t('actions.downloadPdf')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                demo(t('actions.sendEmail'));
              }}
            >
              <Mail />
              {t('actions.sendEmail')}
            </Button>
          </div>

          <Section title={t('panel.customer')}>
            <div className="flex flex-col">
              <span className="text-sm font-medium">{invoice.customer.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {invoice.customer.email}
              </span>
            </div>
            <Row label={field('nationalId')}>
              <Muted value={invoice.customer.nationalId} />
            </Row>
          </Section>

          <Section title={t('panel.itemsCount', { count: invoice.items.length })}>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {invoice.items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{item.description}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {item.service} · {item.subscription ?? t('panel.oneTime')}
                    </span>
                  </div>
                  <span className="text-sm">
                    <Money value={item.amount} />
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-1 px-3">
              <Row label={field('subtotal')}>
                <Money value={invoice.subtotal} />
              </Row>
              <Row label={`${field('taxAmount')} ${String(invoice.taxPercent)}%`}>
                <Money value={invoice.taxAmount} />
              </Row>
              <Row label={field('total')}>
                <span className="font-semibold">
                  <Money value={invoice.total} />
                </span>
              </Row>
            </div>
          </Section>

          <Section title={t('panel.dates')}>
            <Row label={field('createdAt')}>
              <DateTimeCell value={invoice.createdAt} className="items-end" />
            </Row>
            <Row label={field('dueDate')}>
              <Muted value={invoice.dueDate} />
            </Row>
            <Row label={field('paidAt')}>
              <DateTimeCell value={invoice.paidAt} className="items-end" />
            </Row>
          </Section>

          <Section title={t('panel.payment')}>
            <Row label={field('paymentMethod')}>{method(invoice.paymentMethod)}</Row>
            <Row label={field('paidMethod')}>
              {invoice.paidMethod === null ? <Muted value={null} /> : method(invoice.paidMethod)}
            </Row>
            <Row label={field('paymentAttempts')}>
              <Muted value={invoice.paymentAttempts} />
            </Row>
            <Row label={field('emailedAt')}>
              <DateTimeCell value={invoice.emailedAt} className="items-end" />
            </Row>
          </Section>

          <Section title={t('panel.tax')}>
            <Row label={field('docNumber')}>
              <Muted value={invoice.docNumber} />
            </Row>
            <Row label={field('taxDocNumber')}>
              <Muted value={invoice.taxDocNumber} />
            </Row>
            <Row label={field('taxDate')}>
              <Muted value={invoice.taxDate} />
            </Row>
            <Row label={field('taxConfirmationNumber')}>
              {invoice.taxConfirmationNumber ?? (
                <span className="text-muted-foreground">{t('panel.notConfirmed')}</span>
              )}
            </Row>
          </Section>

          <Section title={t('panel.sap')}>
            {inSap ? (
              <>
                <Row label={field('sapDocNum')}>
                  <Muted value={invoice.sapDocNum} />
                </Row>
                <Row label={field('sapOrderDocNum')}>
                  <Muted value={invoice.sapOrderDocNum} />
                </Row>
                <Row label={field('sapIncomingPaymentNumber')}>
                  <Muted value={invoice.sapIncomingPaymentNumber} />
                </Row>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('panel.notInSap')}</p>
            )}
          </Section>
        </div>
      </ScrollArea>
    </div>
  );
}
