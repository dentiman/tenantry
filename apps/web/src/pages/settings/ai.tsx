import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { InfoIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@saas-skeleton/ui/components/ui/alert';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import {
  AI_SETTINGS_DEFAULTS,
  AI_SETTINGS_LIMITS,
  AiSettingsSchema,
  type AiSettings,
} from '@saas-skeleton/contracts';
import { getSettingsAiQueryKey, useSettingsAi, useSettingsUpdateAi } from '../../api/generated/api';
import { ContentSection } from '../../components/section/content-section';
import { applyServerError, FormTextareaField } from '../../components/form';

/**
 * Секція `ai` — персона й інструкції AI-асистента для всієї організації (AI-1c).
 * Незмінні межі асистента (немає доступу до даних, не вигадувати) живуть у коді й
 * ідуть у промпт першими — цей текст їх доповнює, але прибрати не може.
 *
 * Попередження про провайдера стоїть НА САМОМУ екрані, а не в умовах використання
 * (docs/ai-assistant.md §9.3): адмін, який пише сюди внутрішні формулювання, мусить
 * бачити, що вони їдуть до зовнішнього LLM-провайдера з кожним питанням.
 */
export function SettingsAiPage() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { data, isLoading } = useSettingsAi();
  const update = useSettingsUpdateAi();

  const form = useForm<AiSettings>({
    resolver: zodResolver(AiSettingsSchema),
    // Повні defaultValues — вимога applyServerError (звіряє імена полів)
    defaultValues: AI_SETTINGS_DEFAULTS,
  });

  useEffect(() => {
    if (data) {
      form.reset(data);
    }
  }, [data, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync({ data: values });
      await queryClient.invalidateQueries({ queryKey: getSettingsAiQueryKey() });
      toast.add({ type: 'success', title: t('ai.saved') });
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <ContentSection>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/settings' }, { label: t('ai.title') }]}
        subtitle={t('ai.description')}
      />
      {isLoading || !data ? (
        <Spinner aria-label={t('ai.loading')} />
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
          <Alert accent="left">
            <InfoIcon />
            <AlertTitle>{t('ai.providerNoticeTitle')}</AlertTitle>
            <AlertDescription>{t('ai.providerNotice')}</AlertDescription>
          </Alert>

          <FieldGroup>
            <FormTextareaField
              control={form.control}
              name="persona"
              label={t('ai.persona')}
              placeholder={t('ai.personaPlaceholder')}
              description={t('ai.personaHint', { max: AI_SETTINGS_LIMITS.personaMaxChars })}
              rows={3}
            />
            <FormTextareaField
              control={form.control}
              name="instructions"
              label={t('ai.instructions')}
              placeholder={t('ai.instructionsPlaceholder')}
              description={t('ai.instructionsHint', {
                max: AI_SETTINGS_LIMITS.instructionsMaxChars,
              })}
              rows={10}
            />
          </FieldGroup>

          <p className="text-sm text-muted-foreground">{t('ai.boundaries')}</p>

          {form.formState.errors.root?.server && (
            <p className="text-sm text-destructive">{form.formState.errors.root.server.message}</p>
          )}

          <div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('ai.save')}
            </Button>
          </div>
        </form>
      )}
    </ContentSection>
  );
}
