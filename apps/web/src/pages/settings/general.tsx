import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { GeneralSettingsSchema, type GeneralSettings } from '@saas-skeleton/contracts';
import {
  getSettingsBootstrapQueryKey,
  getSettingsGeneralQueryKey,
  useSettingsGeneral,
  useSettingsUpdateGeneral,
} from '../../api/generated/api';
import { ContentSection } from '../../components/section/content-section';
import { applyServerError, FormSelect, FormTextField } from '../../components/form';

/**
 * Секція `general` — один документ, тому й форма одна, і зберігається цілком
 * (PUT). `slug` показуємо, але не редагуємо: на ньому тримається логін по
 * організації, і змінює його лише оператор платформи.
 */
export function SettingsGeneralPage() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { data, isLoading } = useSettingsGeneral();
  const update = useSettingsUpdateGeneral();

  const form = useForm<GeneralSettings>({
    resolver: zodResolver(GeneralSettingsSchema),
    defaultValues: { name: '', locale: 'en', currency: 'USD' },
  });

  useEffect(() => {
    if (!data) return;
    form.reset({ name: data.name, locale: data.locale, currency: data.currency });
  }, [data, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync({ data: values });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getSettingsGeneralQueryKey() }),
        // Валюта й локаль їдуть у bootstrap-зрізі, який тримає весь застосунок
        queryClient.invalidateQueries({ queryKey: getSettingsBootstrapQueryKey() }),
      ]);
      toast.add({ type: 'success', title: t('general.saved') });
    } catch (error) {
      applyServerError(error, form);
    }
  });

  const localeOptions = [{ id: 'en', label: t('general.locales.en') }];

  return (
    <ContentSection>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/settings' }, { label: t('general.title') }]}
        subtitle={t('general.description')}
      />
      {isLoading || !data ? (
        <Spinner aria-label={t('general.loading')} />
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
          <FieldGroup>
            <FormTextField control={form.control} name="name" label={t('general.name')} />
            <FormSelect
              control={form.control}
              name="locale"
              label={t('general.locale')}
              options={localeOptions}
            />
            <FormTextField
              control={form.control}
              name="currency"
              label={t('general.currency')}
              description={t('general.currencyHint')}
            />
          </FieldGroup>

          <p className="text-sm text-muted-foreground">{t('general.slug', { slug: data.slug })}</p>

          {form.formState.errors.root?.server && (
            <p className="text-sm text-destructive">{form.formState.errors.root.server.message}</p>
          )}

          <div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('general.save')}
            </Button>
          </div>
        </form>
      )}
    </ContentSection>
  );
}
