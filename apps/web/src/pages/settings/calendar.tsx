import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@saas-skeleton/ui/components/ui/field';
import { Input } from '@saas-skeleton/ui/components/ui/input';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import { toast } from '@saas-skeleton/ui/components/ui/toast';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import {
  CALENDAR_SETTINGS_DEFAULTS,
  CalendarSettingsSchema,
  type CalendarSettings,
} from '@saas-skeleton/contracts';
import {
  getSettingsBootstrapQueryKey,
  getSettingsCalendarQueryKey,
  useSettingsCalendar,
  useSettingsUpdateCalendar,
} from '../../api/generated/api';
import { ContentSection } from '../../components/section/content-section';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@saas-skeleton/ui/components/ui/select';
import { applyServerError, FormTextField } from '../../components/form';

/** Осмислені варіанти першого дня тижня; решта значень 0..6 контракт приймає */
const WEEK_STARTS = [1, 0, 6] as const;

/**
 * Секція `calendar` — дефолти КОМПАНІЇ (зона, робочі години, нагадування).
 * Особиста зона живе в профілі (`/user-settings`), і це не дублювання: тут
 * фолбек для тих, хто свою не задав.
 */
export function SettingsCalendarPage() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { data, isLoading } = useSettingsCalendar();
  const update = useSettingsUpdateCalendar();

  const form = useForm<CalendarSettings>({
    resolver: zodResolver(CalendarSettingsSchema),
    // Повні defaultValues — вимога applyServerError (звіряє імена полів)
    defaultValues: CALENDAR_SETTINGS_DEFAULTS,
  });

  useEffect(() => {
    if (data) {
      form.reset(data);
    }
  }, [data, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync({ data: values });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getSettingsCalendarQueryKey() }),
        // Сітка бере ці значення з bootstrap-зрізу
        queryClient.invalidateQueries({ queryKey: getSettingsBootstrapQueryKey() }),
      ]);
      toast.add({ type: 'success', title: t('calendar.saved') });
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <ContentSection title={t('calendar.title')} description={t('calendar.description')}>
      <PageBreadcrumbs
        items={[{ label: t('title'), to: '/settings' }, { label: t('calendar.title') }]}
      />
      {isLoading || !data ? (
        <Spinner aria-label={t('calendar.loading')} />
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => void onSubmit(e)} noValidate>
          <FieldGroup>
            <FormTextField
              control={form.control}
              name="timeZone"
              label={t('calendar.timeZone')}
              description={t('calendar.timeZoneHint')}
            />
            <Field>
              <FieldLabel htmlFor="week-starts-on">{t('calendar.weekStartsOn')}</FieldLabel>
              {/* Не `FormSelect`: він працює з рядковим ключем, а поле числове
                  (`Date.getDay()`-формат — той, який споживають і Intl, і сітка).
                  Конвертація тут, а не другий тип у контракті */}
              <Select
                items={WEEK_STARTS.map((day) => ({
                  value: String(day),
                  label: t(`calendar.weekDays.${String(day)}`),
                }))}
                value={String(form.watch('weekStartsOn'))}
                onValueChange={(next: string | null) => {
                  if (next !== null) {
                    form.setValue('weekStartsOn', Number.parseInt(next, 10), {
                      shouldDirty: true,
                    });
                  }
                }}
              >
                <SelectTrigger id="week-starts-on" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {WEEK_STARTS.map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {t(`calendar.weekDays.${String(day)}`)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="work-day-start">{t('calendar.workDayStart')}</FieldLabel>
                <Input id="work-day-start" type="time" {...form.register('workDayStart')} />
              </Field>
              <Field>
                <FieldLabel htmlFor="work-day-end">{t('calendar.workDayEnd')}</FieldLabel>
                <Input id="work-day-end" type="time" {...form.register('workDayEnd')} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="default-duration">{t('calendar.duration')}</FieldLabel>
              <Input
                id="default-duration"
                type="number"
                min={5}
                max={1440}
                {...form.register('defaultEventDurationMinutes', { valueAsNumber: true })}
              />
              <FieldDescription>{t('calendar.durationHint')}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="default-reminder">{t('calendar.reminder')}</FieldLabel>
              <Input
                id="default-reminder"
                type="number"
                min={0}
                max={40320}
                {...form.register('defaultReminderMinutes', { valueAsNumber: true })}
              />
              <FieldDescription>{t('calendar.reminderHint')}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="default-all-day-reminder">
                {t('calendar.allDayReminder')}
              </FieldLabel>
              <Input
                id="default-all-day-reminder"
                type="number"
                min={0}
                max={40320}
                {...form.register('defaultAllDayReminderMinutes', { valueAsNumber: true })}
              />
              <FieldDescription>{t('calendar.allDayReminderHint')}</FieldDescription>
            </Field>
          </FieldGroup>

          {form.formState.errors.root?.server && (
            <p className="text-sm text-destructive">{form.formState.errors.root.server.message}</p>
          )}

          <div>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('calendar.save')}
            </Button>
          </div>
        </form>
      )}
    </ContentSection>
  );
}
