import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { EmailChangeRequestSchema, type EmailChangeRequest } from '@saas-skeleton/contracts';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@saas-skeleton/ui/components/ui/field';
import { Input } from '@saas-skeleton/ui/components/ui/input';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { formatDate, formatDateTime } from '@saas-skeleton/ui/lib/format';
import { useAccountGetProfile, useAccountRequestEmailChange } from '../../api/generated/api';
import { ContentSection } from '../../components/section/content-section';
import { applyServerError, FormPasswordField, FormTextField } from '../../components/form';
import { SettingsStatus } from './status';

/** Рядок «підпис → значення» — та сама форма, що на картці юзера */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm text-foreground">{children}</span>
    </div>
  );
}

/**
 * Факти акаунта, які юзер собі не міняє напряму з цієї форми. Email — окремий
 * флоу нижче (AUTH-3): підтвердження йде на НОВУ адресу, тому саме поле тут
 * лишається read-only показом ПОТОЧНОЇ адреси.
 */
export function UserSettingsAccountPage() {
  const { t } = useTranslation('user-settings');
  const { data, isPending, isError } = useAccountGetProfile();

  return (
    <ContentSection>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/user-settings' }, { label: t('account.title') }]}
        subtitle={t('account.description')}
      />
      <SettingsStatus isPending={isPending} isError={isError || !data}>
        {data && (
          <div className="flex flex-col gap-6">
            <Field>
              <FieldLabel htmlFor="account-email">{t('account.email')}</FieldLabel>
              <Input id="account-email" value={data.email} disabled readOnly />
              <FieldDescription>{t('account.emailHint')}</FieldDescription>
            </Field>

            <div className="flex flex-col divide-y divide-border">
              <Fact label={t('account.role')}>
                <Badge variant="secondary">{data.role}</Badge>
              </Fact>
              <Fact label={t('account.status')}>
                <Badge variant={data.isActive ? 'success' : 'secondary'}>
                  {data.isActive ? t('account.active') : t('account.disabled')}
                </Badge>
              </Fact>
              <Fact label={t('account.createdAt')}>{formatDate(data.createdAt)}</Fact>
              <Fact label={t('account.lastSeenAt')}>
                {data.lastSeenAt ? formatDateTime(data.lastSeenAt) : t('account.never')}
              </Fact>
            </div>

            <Separator />
            <EmailChangeForm />
          </div>
        )}
      </SettingsStatus>
    </ContentSection>
  );
}

/**
 * AUTH-3: запит зміни email. Успіх — завжди «лист надіслано» (204), той самий
 * прийом без оракула, що скидання пароля: форма не каже, чи адреса зайнята
 * (це видно лише на confirm, коли вже пізно перебирати варіанти).
 */
function EmailChangeForm() {
  const { t } = useTranslation('user-settings');
  const [sent, setSent] = useState(false);
  const requestEmailChange = useAccountRequestEmailChange();

  const form = useForm<EmailChangeRequest>({
    resolver: zodResolver(EmailChangeRequestSchema),
    defaultValues: { newEmail: '', currentPassword: '' },
  });
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = form;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await requestEmailChange.mutateAsync({ data: values });
      reset();
      setSent(true);
    } catch (error) {
      // Невірний пароль → fieldErrors.currentPassword; зайнятий email → fieldErrors.newEmail
      applyServerError(error, form);
    }
  });

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">{t('account.changeEmail.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('account.changeEmail.description')}</p>
      </div>

      {sent && (
        <p className="text-sm text-foreground">{t('account.changeEmail.sent')}</p>
      )}

      <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
        <FieldGroup>
          <FormTextField
            control={control}
            name="newEmail"
            label={t('account.changeEmail.newEmail')}
            type="email"
            autoComplete="email"
          />
          <FormPasswordField
            control={control}
            name="currentPassword"
            label={t('account.changeEmail.currentPassword')}
            autoComplete="current-password"
          />
        </FieldGroup>

        {errors.root?.server && (
          <p className="text-sm text-destructive">{errors.root.server.message}</p>
        )}

        <div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? t('account.changeEmail.submitting')
              : t('account.changeEmail.submit')}
          </Button>
        </div>
      </form>
    </section>
  );
}
