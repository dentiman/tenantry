import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { PriceInputSchema, type CreateAiModelPrice } from '@saas-skeleton/contracts/platform';
import { applyServerError, FormDateField, FormTextField } from '@saas-skeleton/ui/components/form';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@saas-skeleton/ui/components/ui/dialog';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { getAiCostsListPricesQueryKey, useAiCostsCreatePrice } from '../../../api/generated/api';

/**
 * Форма — рядки, як їх друкує людина: порожнє поле кешу означає «окремої ціни немає», а
 * порожня дата — «з цього моменту». У контракт це перетворюється при відправці; гроші
 * лишаються рядками всю дорогу (design.md R10)
 */
const optionalPrice = z.union([z.literal(''), PriceInputSchema]);
const FormSchema = z.object({
  provider: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(200),
  inputPerMillion: PriceInputSchema,
  outputPerMillion: PriceInputSchema,
  cacheReadPerMillion: optionalPrice,
  cacheWritePerMillion: optionalPrice,
  requestPrice: optionalPrice,
  validFrom: z.string().nullable(),
});
type FormValues = z.infer<typeof FormSchema>;

const DEFAULTS: FormValues = {
  provider: '',
  model: '',
  inputPerMillion: '',
  outputPerMillion: '',
  cacheReadPerMillion: '',
  cacheWritePerMillion: '',
  requestPrice: '',
  validFrom: null,
};

function toPayload(values: FormValues): CreateAiModelPrice {
  return {
    provider: values.provider,
    model: values.model,
    inputPerMillion: values.inputPerMillion,
    outputPerMillion: values.outputPerMillion,
    cacheReadPerMillion: values.cacheReadPerMillion === '' ? null : values.cacheReadPerMillion,
    cacheWritePerMillion: values.cacheWritePerMillion === '' ? null : values.cacheWritePerMillion,
    ...(values.requestPrice !== '' ? { requestPrice: values.requestPrice } : {}),
    // Цивільна дата → початок доби UTC: так межі періодів рахує і звіт витрат
    ...(values.validFrom ? { validFrom: `${values.validFrom}T00:00:00.000Z` } : {}),
  };
}

/** Ручний тариф (AI-5b, design.md R6/R8) — для провайдерів, що не повертають вартість */
export function AiPriceCreateModal() {
  const { t } = useTranslation('ai');
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const create = useAiCostsCreatePrice();
  const form = useForm<FormValues>({ resolver: zodResolver(FormSchema), defaultValues: DEFAULTS });
  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting, errors },
  } = form;

  const close = (open: boolean): void => {
    setIsOpen(open);
    if (!open) {
      reset(DEFAULTS);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      await create.mutateAsync({ data: toPayload(values) });
      await queryClient.invalidateQueries({ queryKey: getAiCostsListPricesQueryKey() });
      toast.add({ type: 'success', title: t('prices.create.added') });
      close(false);
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <Dialog open={isOpen} onOpenChange={close}>
      <DialogTrigger render={<Button size="sm" />}>
        {t('prices.create.trigger')}
        <Plus />
      </DialogTrigger>
      <DialogContent className="flex max-h-[85svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]">
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle>{t('prices.create.heading')}</DialogTitle>
          <DialogDescription>{t('prices.create.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
          onSubmit={(e) => void onSubmit(e)}
          noValidate
        >
          <FieldGroup>
            <FormTextField
              control={control}
              name="provider"
              label={t('prices.create.provider')}
              description={t('prices.create.providerHint')}
            />
            <FormTextField
              control={control}
              name="model"
              label={t('prices.create.model')}
              description={t('prices.create.modelHint')}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormTextField
                control={control}
                name="inputPerMillion"
                label={t('prices.create.input')}
              />
              <FormTextField
                control={control}
                name="outputPerMillion"
                label={t('prices.create.output')}
              />
              <FormTextField
                control={control}
                name="cacheReadPerMillion"
                label={t('prices.create.cacheRead')}
              />
              <FormTextField
                control={control}
                name="cacheWritePerMillion"
                label={t('prices.create.cacheWrite')}
              />
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{t('prices.create.cacheHint')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormTextField
                control={control}
                name="requestPrice"
                label={t('prices.create.request')}
              />
              <FormDateField
                control={control}
                name="validFrom"
                label={t('prices.create.validFrom')}
                description={t('prices.create.validFromHint')}
              />
            </div>
          </FieldGroup>

          {errors.root?.server && (
            <p className="text-sm text-destructive">{errors.root.server.message}</p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose render={<Button variant="secondary" />}>
              {t('prices.create.cancel')}
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('prices.create.submitting') : t('prices.create.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
