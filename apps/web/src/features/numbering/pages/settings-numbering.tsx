import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import {
  SetNextNumberSchema,
  UpdateNumberSeriesSchema,
  type SetNextNumber,
  type UpdateNumberSeries,
} from '@saas-skeleton/contracts';
import {
  getNumberingListQueryKey,
  getCustomersFindAllQueryKey,
  useNumberingList,
  useNumberingSetNextNumber,
  useNumberingUpdate,
} from '../../../api/generated/api';
import type { NumberSeriesResponseDtoOutput } from '../../../api/generated/model/numberSeriesResponseDtoOutput';
import { ContentSection } from '../../../components/section/content-section';
import { applyServerError, FormTextField } from '../../../components/form';

/**
 * Нумерація сутностей тенанта (docs/customers.md §5). Дві незалежні дії, свідомо
 * розділені: формат і початковий номер — це КОНФІГ (діє на майбутні періоди), а
 * «наступний номер» — операція над самим лічильником. Змішати їх в одну форму
 * означало б приховати, що друга не відкочується.
 */
function SeriesForm({ series }: { series: NumberSeriesResponseDtoOutput }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const update = useNumberingUpdate();
  const setNext = useNumberingSetNextNumber();

  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getNumberingListQueryKey() }),
      // Лейбл номера рахується з цього конфігу — список кастомерів застарів
      queryClient.invalidateQueries({ queryKey: getCustomersFindAllQueryKey() }),
    ]);
  };

  const configForm = useForm<UpdateNumberSeries>({
    resolver: zodResolver(UpdateNumberSeriesSchema),
    defaultValues: { prefix: '', padding: 0, startValue: 1 },
  });
  const counterForm = useForm<SetNextNumber>({
    resolver: zodResolver(SetNextNumberSchema),
    defaultValues: { nextNumber: 1 },
  });

  useEffect(() => {
    configForm.reset({
      prefix: series.prefix,
      padding: series.padding,
      startValue: series.startValue,
    });
    counterForm.reset({ nextNumber: series.nextNumber });
  }, [series, configForm, counterForm]);

  const onSaveConfig = configForm.handleSubmit(async (values) => {
    try {
      await update.mutateAsync({ name: series.name, data: values });
      await invalidate();
      toast.add({ type: 'success', title: t('numbering.saved') });
    } catch (error) {
      applyServerError(error, configForm);
    }
  });

  const onSetNext = counterForm.handleSubmit(async (values) => {
    try {
      const next = await setNext.mutateAsync({ name: series.name, data: values });
      await invalidate();
      // Показуємо фактичний номер: спроба знизити — тихий no-op, і людина мусить
      // побачити, що лічильник лишився там, де був
      toast.add({ type: 'success', title: t('numbering.moved', { next: next.nextLabel }) });
    } catch (error) {
      applyServerError(error, counterForm);
    }
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {t(`numbering.series.${series.name}`)}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('numbering.nextIs', { label: series.nextLabel })}
        </p>
      </div>

      <form className="flex flex-col gap-4" onSubmit={(e) => void onSaveConfig(e)} noValidate>
        <FieldGroup>
          <FormTextField
            control={configForm.control}
            name="prefix"
            label={t('numbering.prefix')}
            description={t('numbering.prefixHint')}
          />
          <FormTextField
            control={configForm.control}
            name="padding"
            type="number"
            label={t('numbering.padding')}
            description={t('numbering.paddingHint')}
          />
          <FormTextField
            control={configForm.control}
            name="startValue"
            type="number"
            label={t('numbering.startValue')}
            description={t('numbering.startValueHint')}
          />
        </FieldGroup>
        {configForm.formState.errors.root?.server && (
          <p className="text-sm text-destructive">
            {configForm.formState.errors.root.server.message}
          </p>
        )}
        <div>
          <Button type="submit" disabled={configForm.formState.isSubmitting}>
            {t('numbering.save')}
          </Button>
        </div>
      </form>

      <Separator />

      <form className="flex flex-col gap-4" onSubmit={(e) => void onSetNext(e)} noValidate>
        <FieldGroup>
          <FormTextField
            control={counterForm.control}
            name="nextNumber"
            type="number"
            label={t('numbering.nextNumber')}
            description={t('numbering.nextNumberHint')}
          />
        </FieldGroup>
        {counterForm.formState.errors.root?.server && (
          <p className="text-sm text-destructive">
            {counterForm.formState.errors.root.server.message}
          </p>
        )}
        <div>
          <Button type="submit" variant="secondary" disabled={counterForm.formState.isSubmitting}>
            {t('numbering.move')}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function SettingsNumberingPage() {
  const { t } = useTranslation('settings');
  const { data, isLoading } = useNumberingList();

  return (
    <ContentSection>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/settings' }, { label: t('numbering.title') }]}
        subtitle={t('numbering.description')}
      />
      {isLoading || !data ? (
        <Spinner aria-label={t('numbering.loading')} />
      ) : (
        <div className="flex flex-col gap-8">
          {data.items.map((series) => (
            <SeriesForm key={series.name} series={series} />
          ))}
        </div>
      )}
    </ContentSection>
  );
}
