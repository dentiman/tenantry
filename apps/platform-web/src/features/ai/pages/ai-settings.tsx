import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Eye, EyeOff, KeyRound, TriangleAlert } from 'lucide-react';
import type {
  PlatformAiSettingsResponse,
  UpdatePlatformAiSettings,
} from '@saas-skeleton/contracts/platform';
import {
  applyServerError,
  FormPasswordField,
  FormSelect,
  FormTextField,
} from '@saas-skeleton/ui/components/form';
import { PageHeader } from '@saas-skeleton/ui/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@saas-skeleton/ui/components/ui/alert';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@saas-skeleton/ui/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@saas-skeleton/ui/components/ui/input-group';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { Switch } from '@saas-skeleton/ui/components/ui/switch';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { formatDateTime } from '@saas-skeleton/ui/lib/format';
import {
  getAiSettingsEventsQueryKey,
  getAiSettingsGetQueryKey,
  useAiSettingsEvents,
  useAiSettingsGet,
  useAiSettingsReveal,
  useAiSettingsUpdate,
} from '../../../api/generated/api';
import { ContentSection } from '../../../components/section/content-section';

/**
 * Форма — не контракт напряму: «з env» тут окреме значення селекта, а порожній рядок
 * поля означає «не задано в UI». У контракт це перетворюється при відправці (null).
 * Сервер однаково валідує все сам — ця схема лише для миттєвої підказки у формі.
 */
const FormSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['env', 'fake', 'openai-compat']),
  baseUrl: z.string().trim().max(500),
  model: z.string().trim().max(200),
  /** Новий ключ; порожньо — не чіпати збережений */
  apiKey: z.string().trim().max(500),
  clearApiKey: z.boolean(),
});
type FormValues = z.infer<typeof FormSchema>;

function toFormValues(data: PlatformAiSettingsResponse): FormValues {
  return {
    enabled: data.enabled,
    provider: data.provider ?? 'env',
    baseUrl: data.baseUrl ?? '',
    model: data.model ?? '',
    apiKey: '',
    clearApiKey: false,
  };
}

function toPayload(values: FormValues): UpdatePlatformAiSettings {
  return {
    enabled: values.enabled,
    provider: values.provider === 'env' ? null : values.provider,
    baseUrl: values.baseUrl === '' ? null : values.baseUrl,
    model: values.model === '' ? null : values.model,
    // Відсутній ключ у payload — «не чіпати»; null — прибрати; рядок — замінити
    ...(values.clearApiKey
      ? { apiKey: null }
      : values.apiKey !== ''
        ? { apiKey: values.apiKey }
        : {}),
  };
}

/**
 * Налаштування AI-асистента платформи (AI-5a, docs/ai-platform-controls.md §2): одна модель
 * на всю платформу, вмикач для всіх tenant-ів, ключ провайдера лише зашифрований. Поле,
 * не задане тут, береться з env — підказка під кожним полем показує, що діє зараз і звідки.
 */
export function AiSettingsPage() {
  const { t } = useTranslation('ai');
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useAiSettingsGet();
  const update = useAiSettingsUpdate();

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      enabled: true,
      provider: 'env',
      baseUrl: '',
      model: '',
      apiKey: '',
      clearApiKey: false,
    },
  });

  useEffect(() => {
    if (data) form.reset(toFormValues(data));
  }, [data, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync({ data: toPayload(values) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getAiSettingsGetQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getAiSettingsEventsQueryKey() }),
      ]);
      toast.add({ type: 'success', title: t('saved') });
    } catch (error) {
      applyServerError(error, form);
    }
  });

  const source = (field: keyof PlatformAiSettingsResponse['effective']['sources']): string =>
    data ? t(`source.${data.effective.sources[field]}`) : '';

  return (
    <ContentSection>
      <PageHeader
        breadcrumbs={[{ label: t('title') }, { label: t('settings.title') }]}
        subtitle={t('settings.description')}
      />

      {isPending ? (
        <div className="flex justify-center py-10">
          <Spinner aria-label={t('loading')} />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">{t('loadFailed')}</p>
      ) : (
        <form className="flex flex-col gap-6" onSubmit={(e) => void onSubmit(e)} noValidate>
          {!data.installationEnabled && (
            <Alert accent="left" variant="warning">
              <TriangleAlert />
              <AlertTitle>{t('installationDisabledTitle')}</AlertTitle>
              <AlertDescription>{t('installationDisabled')}</AlertDescription>
            </Alert>
          )}

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="ai-platform-enabled">{t('enabled')}</FieldLabel>
              <FieldDescription>{t('enabledHint')}</FieldDescription>
            </FieldContent>
            <Switch
              id="ai-platform-enabled"
              checked={form.watch('enabled')}
              onCheckedChange={(checked) => {
                form.setValue('enabled', checked, { shouldDirty: true });
              }}
            />
          </Field>

          <Separator />

          <FieldGroup>
            <FormSelect
              control={form.control}
              name="provider"
              label={t('provider')}
              options={[
                { id: 'env', label: t('providerFromEnv', { value: data.effective.provider }) },
                { id: 'openai-compat', label: t('providers.openai-compat') },
                { id: 'fake', label: t('providers.fake') },
              ]}
            />
            <FormTextField
              control={form.control}
              name="baseUrl"
              label={t('baseUrl')}
              placeholder={t('fromEnvPlaceholder')}
              description={t('effective', {
                value: data.effective.baseUrl ?? t('notSet'),
                source: source('baseUrl'),
              })}
            />
            <FormTextField
              control={form.control}
              name="model"
              label={t('model')}
              placeholder={t('fromEnvPlaceholder')}
              description={t('effective', { value: data.effective.model, source: source('model') })}
            />
          </FieldGroup>

          <Separator />

          <ApiKeySection data={data} form={form} />

          {form.formState.errors.root?.server && (
            <p className="text-sm text-destructive">{form.formState.errors.root.server.message}</p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('save')}
            </Button>
            {data.updatedAt && (
              <span className="text-sm text-muted-foreground">
                {t('updated', { at: formatDateTime(data.updatedAt), by: data.updatedBy ?? '—' })}
              </span>
            )}
          </div>
        </form>
      )}

      {data && <SettingsEvents />}
    </ContentSection>
  );
}

/**
 * Ключ провайдера. Збережений ключ — лише маска; «око» явно розкриває його через окремий
 * ендпоінт (подія в журналі) і ховає знову. Новий ключ вводиться окремим полем.
 */
function ApiKeySection({
  data,
  form,
}: {
  data: PlatformAiSettingsResponse;
  form: ReturnType<typeof useForm<FormValues>>;
}) {
  const { t } = useTranslation('ai');
  const queryClient = useQueryClient();
  const reveal = useAiSettingsReveal();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const clear = form.watch('clearApiKey');

  // Збережений ключ змінився (зберегли новий чи прибрали) — розкритий текст застарів
  useEffect(() => {
    setRevealed(null);
    setReplacing(false);
  }, [data.apiKey.masked]);

  const toggleReveal = async (): Promise<void> => {
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    const result = await reveal.mutateAsync();
    setRevealed(result.apiKey);
    void queryClient.invalidateQueries({ queryKey: getAiSettingsEventsQueryKey() });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-icon" aria-hidden />
        <h2 className="text-sm font-medium">{t('apiKey.title')}</h2>
      </div>

      {!data.encryptionAvailable && (
        <Alert accent="left" variant="warning">
          <TriangleAlert />
          <AlertTitle>{t('apiKey.noEncryptionTitle')}</AlertTitle>
          <AlertDescription>{t('apiKey.noEncryption')}</AlertDescription>
        </Alert>
      )}

      {data.apiKey.configured && !clear && (
        <Field>
          <FieldLabel htmlFor="ai-api-key-stored">{t('apiKey.stored')}</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="ai-api-key-stored"
              readOnly
              className="font-mono"
              value={revealed ?? data.apiKey.masked ?? ''}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={revealed !== null ? t('apiKey.hide') : t('apiKey.reveal')}
                disabled={reveal.isPending}
                onClick={() => void toggleReveal()}
              >
                {revealed !== null ? <EyeOff /> : <Eye />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription>{t('apiKey.revealHint')}</FieldDescription>
        </Field>
      )}

      {!data.apiKey.configured && (
        <p className="text-sm text-muted-foreground">
          {data.effective.apiKeyPresent ? t('apiKey.fromEnv') : t('apiKey.none')}
        </p>
      )}

      {data.encryptionAvailable && (!data.apiKey.configured || replacing) && !clear && (
        <FormPasswordField
          control={form.control}
          name="apiKey"
          label={data.apiKey.configured ? t('apiKey.replaceLabel') : t('apiKey.setLabel')}
          autoComplete="off"
          description={t('apiKey.setHint')}
        />
      )}

      {data.apiKey.configured && (
        <div className="flex flex-wrap gap-2">
          {!replacing && !clear && data.encryptionAvailable && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setReplacing(true);
              }}
            >
              {t('apiKey.replace')}
            </Button>
          )}
          <Button
            type="button"
            variant={clear ? 'outline' : 'ghost'}
            size="sm"
            onClick={() => {
              form.setValue('clearApiKey', !clear, { shouldDirty: true });
              form.setValue('apiKey', '');
            }}
          >
            {clear ? t('apiKey.undoClear') : t('apiKey.clear')}
          </Button>
          {clear && (
            <span className="self-center text-sm text-muted-foreground">
              {t('apiKey.clearPending')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Журнал: хто й коли змінював налаштування або розкривав ключ */
function SettingsEvents() {
  const { t } = useTranslation('ai');
  const { data } = useAiSettingsEvents();
  if (!data || data.items.length === 0) return null;

  return (
    <div className="mt-8 flex flex-col gap-2">
      <h2 className="text-sm font-medium">{t('events.title')}</h2>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {data.items.map((event) => (
          <li
            key={event.id}
            className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm"
          >
            <span>
              {event.type === 'key_revealed'
                ? t('events.keyRevealed')
                : t('events.updated', { fields: Object.keys(event.changes).join(', ') })}
            </span>
            <span className="text-muted-foreground">
              {event.actorLabel ?? '—'} · {formatDateTime(event.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
