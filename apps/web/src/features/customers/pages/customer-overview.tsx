import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@saas-skeleton/ui/components/ui/card';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { formatDate, formatDateTime } from '@saas-skeleton/ui/lib/format';
import { useCustomersFindOne } from '../../../api/generated/api';
import { PhoneNumber } from '../../../components/phone-number';
import { SlotOutlet } from '../../../lib/slots';
import { formatCustomerAddress } from '../customer-address';
import { customerOverviewCards } from '../customer-detail-slots';

/** Рядок «підпис → значення» у картках: одна форма на всі групи (як на /users/$userId) */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm text-foreground">{children}</span>
    </div>
  );
}

/**
 * Вкладка «Огляд» картки кастомера — індексний дочірній маршрут `CustomerDetailLayout`.
 * Кастомера бере з того самого кешу запитів, що й лейаут: окремого запиту немає.
 */
export function CustomerOverviewTab() {
  const { t } = useTranslation(['customers']);
  const { customerId } = useParams({ from: '/app/workspace/customers/$customerId' });
  const { data: customer } = useCustomersFindOne(customerId);
  // Завантаження і «не знайдено» показує лейаут — сюди без кастомера не доходить
  if (!customer) {
    return null;
  }

  const address = formatCustomerAddress(customer);

  return (
    <div className="flex flex-col gap-4">
      {/* Контакти — першими: за телефоном/поштою на картку заходять найчастіше */}
      <Card>
        <CardHeader>
          <CardTitle>{t('detail.contact.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Fact label={t('detail.contact.email')}>
            {customer.email ?? t('detail.contact.empty')}
          </Fact>
          <Separator />
          <Fact label={t('detail.contact.phone')}>
            <PhoneNumber value={customer.phone} />
          </Fact>
          <Separator />
          <Fact label={t('detail.contact.website')}>
            {customer.website ?? t('detail.contact.empty')}
          </Fact>
          <Separator />
          <Fact label={t('detail.contact.address')}>{address || t('detail.contact.empty')}</Fact>
        </CardContent>
      </Card>

      {/* Картки фіч — одразу після контактів: найближчі зустрічі (календар) — те, що
        питають на картці клієнта наступним. Слот, а не імпорт (docs/modules.md §4) */}
      <SlotOutlet
        slot={customerOverviewCards}
        props={{ customerId: customer.id, customerName: customer.name }}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('detail.state.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Fact label={t('detail.state.status')}>{t(`status.${customer.status}`)}</Fact>
          <Separator />
          <Fact label={t('detail.state.owner')}>
            {customer.owner ? (
              (customer.owner.name ?? customer.owner.email)
            ) : (
              <span className="text-muted-foreground">{t('owner.none')}</span>
            )}
          </Fact>
          <Separator />
          <Fact label={t('detail.state.contacts')}>{customer.contactsCount}</Fact>
          <Separator />
          <Fact label={t('detail.state.customerSince')}>{formatDate(customer.createdAt)}</Fact>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('detail.business.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Fact label={t('detail.business.kind')}>{t(`kind.${customer.kind}`)}</Fact>
          <Separator />
          <Fact label={t('detail.business.legalName')}>
            {customer.legalName ?? t('detail.contact.empty')}
          </Fact>
          <Separator />
          <Fact label={t('detail.business.taxId')}>
            {customer.taxId ?? t('detail.contact.empty')}
          </Fact>
          <Separator />
          <Fact label={t('detail.business.currency')}>{customer.currency}</Fact>
          <Separator />
          <Fact label={t('detail.business.externalId')}>
            {customer.externalId ?? t('detail.contact.empty')}
          </Fact>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('detail.tags.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {customer.tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('detail.tags.empty')}</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {customer.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('detail.notes.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {customer.notes ? (
            <p className="text-sm whitespace-pre-wrap text-foreground">{customer.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('detail.notes.empty')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('detail.meta.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Fact label={t('detail.meta.created')}>{formatDateTime(customer.createdAt)}</Fact>
          <Separator />
          <Fact label={t('detail.meta.updated')}>{formatDateTime(customer.updatedAt)}</Fact>
          <Separator />
          <Fact label={t('detail.meta.id')}>
            <code className="font-mono text-xs break-all">{customer.id}</code>
          </Fact>
        </CardContent>
      </Card>
    </div>
  );
}
