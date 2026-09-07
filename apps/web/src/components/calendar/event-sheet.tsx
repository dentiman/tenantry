import { useEffect, useState } from 'react';
import { TZDate } from '@date-fns/tz';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { CalendarOffIcon, TrashIcon } from 'lucide-react';
import type { CalendarEventResponse } from '@saas-skeleton/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@saas-skeleton/ui/components/ui/alert-dialog';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@saas-skeleton/ui/components/ui/field';
import { Input } from '@saas-skeleton/ui/components/ui/input';
import { Switch } from '@saas-skeleton/ui/components/ui/switch';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@saas-skeleton/ui/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import {
  getCalendarAgendaQueryKey,
  getCalendarFindWindowQueryKey,
  useCalendarCreate,
  useCalendarRemove,
  useCalendarSetAttendees,
  useCalendarSetReminders,
  useCalendarSetRsvp,
  useCalendarSetStatus,
  useCalendarUpdate,
} from '../../api/generated/api';
import { ActivityFeed } from '../activity/activity-feed';
import { useAuthStore } from '../../stores/auth.store';
import { applyServerError, FormSelect, FormTextField, FormTextareaField } from '../form';
import { AttendeePicker } from './attendee-picker';
import { CustomerSelect } from './customer-select';
import { ReminderRows } from './reminder-rows';
import { dayKey, formatDateTime, toInstantIso } from '../../lib/calendar-date';

/**
 * Форма події. Схема ЛОКАЛЬНА, а не з `contracts`, свідомо: у формі час живе
 * трьома полями (`date` + `startTime` + `endTime`), бо саме так його вводить
 * людина, а контракт бере ISO-інстанти. Перетворення одне й у одному місці —
 * `toIso` нижче.
 */
const FormSchema = z.object({
  title: z.string().trim().min(1),
  allDay: z.boolean(),
  date: z.string().min(1),
  /** Для all-day — останній день (включно, як бачить людина) */
  endDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  kind: z.enum(['MEETING', 'CALL', 'DEADLINE', 'OUT_OF_OFFICE', 'OTHER']),
  location: z.string(),
  description: z.string(),
  customerId: z.string().nullable(),
  isPrivate: z.boolean(),
  busy: z.boolean(),
  attendeeIds: z.array(z.string()),
  reminders: z.array(z.number()),
});
type FormValues = z.infer<typeof FormSchema>;

/**
 * `yyyy-MM-dd` + `HH:mm` у зоні події → ISO-інстант із `Z`.
 *
 * `toInstantIso`, а не `TZDate.toISOString()`: другий дає форму зі зсувом, яку
 * `z.iso.datetime()` у контрактах не приймає (див. `toInstantIso`).
 */
function toIso(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  const [hour, minute] = time.split(':').map((part) => Number.parseInt(part, 10));
  return toInstantIso(
    new TZDate(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, timeZone),
  );
}

/** Опівніч наступної доби після `date` — ексклюзивна межа all-day */
function nextDayIso(date: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  // Через полудень: +24 год у ніч переходу на літній час дали б 01:00
  const noon = new TZDate(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12, 0, timeZone);
  const nextNoon = new TZDate(noon.getTime() + 86_400_000, timeZone);
  return toInstantIso(
    new TZDate(nextNoon.getFullYear(), nextNoon.getMonth(), nextNoon.getDate(), timeZone),
  );
}

function timeOf(instant: string, timeZone: string): string {
  const zoned = new TZDate(new Date(instant), timeZone);
  return `${String(zoned.getHours()).padStart(2, '0')}:${String(zoned.getMinutes()).padStart(2, '0')}`;
}

/** Кінець all-day у моделі ЕКСКЛЮЗИВНИЙ, а людині показуємо останній день */
function inclusiveEndKey(event: CalendarEventResponse, timeZone: string): string {
  return dayKey(new Date(new Date(event.endsAt).getTime() - 86_400_000), timeZone);
}

export interface EventSheetTarget {
  /** Наявна подія або чернетка з передзаповненим часом */
  event: CalendarEventResponse | null;
  draft?: { startsAt: Date; endsAt: Date; customerId?: string | null };
}

interface EventSheetProps {
  target: EventSheetTarget | null;
  timeZone: string;
  defaultDurationMinutes: number;
  defaultReminderMinutes: number | null;
  onClose: () => void;
}

export function EventSheet({
  target,
  timeZone,
  defaultDurationMinutes,
  defaultReminderMinutes,
  onClose,
}: EventSheetProps) {
  const { t } = useTranslation('calendar');
  const queryClient = useQueryClient();
  const createEvent = useCalendarCreate();
  const updateEvent = useCalendarUpdate();
  const setAttendees = useCalendarSetAttendees();
  const setReminders = useCalendarSetReminders();
  const setStatus = useCalendarSetStatus();
  const removeEvent = useCalendarRemove();
  const setRsvp = useCalendarSetRsvp();

  const event = target?.event ?? null;
  const isNew = event === null;
  const canEdit = event?.canEdit ?? true;
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  /**
   * Примітка живе в локальному стані, а не у формі події: вона їде окремим
   * ендпоінтом (`POST /rsvp`) разом із відповіддю, і до `PATCH` події стосунку
   * не має — учасник, який не може редагувати подію, свою примітку змінює вільно.
   */
  const [rsvpComment, setRsvpComment] = useState('');

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: emptyValues(timeZone, defaultDurationMinutes, defaultReminderMinutes),
  });
  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { isSubmitting, errors },
  } = form;
  const allDay = watch('allDay');

  // Форма перезаряджається на кожну зміну цілі: панель живе в дереві постійно
  // (як ActivityDrawer), тому без цього друга подія показувала б першу
  useEffect(() => {
    if (!target) {
      return;
    }
    reset(
      target.event
        ? valuesOf(target.event, timeZone)
        : draftValues(target.draft, timeZone, defaultDurationMinutes, defaultReminderMinutes),
    );
    setRsvpComment(
      target.event?.attendees.find((attendee) => attendee.user.id === currentUserId)?.comment ?? '',
    );
  }, [target, timeZone, defaultDurationMinutes, defaultReminderMinutes, reset, currentUserId]);

  const invalidate = async (): Promise<void> => {
    // Інвалідація ЗА СТОРІНКОЮ, а не зсередини гріда — той самий контракт, що в
    // DataGrid: вікно і agenda мають різні ключі, обидва застаріли
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getCalendarFindWindowQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getCalendarAgendaQueryKey() }),
    ]);
  };

  const onSubmit = handleSubmit(async (values) => {
    const startsAt = values.allDay
      ? toIso(values.date, '00:00', timeZone)
      : toIso(values.date, values.startTime, timeZone);
    const endsAt = values.allDay
      ? // Людина обрала останній день ВКЛЮЧНО, а модель тримає ексклюзивний
        // кінець — добу додає клієнт, бо саме він знає, що показував у полі.
        // Сервер усе одно нормалізує межі до опівночі в зоні події
        nextDayIso(values.endDate || values.date, timeZone)
      : toIso(values.date, values.endTime, timeZone);

    const payload = {
      title: values.title,
      description: values.description,
      location: values.location,
      kind: values.kind,
      visibility: values.isPrivate ? ('PRIVATE' as const) : ('DEFAULT' as const),
      busy: values.busy,
      startsAt,
      endsAt,
      timeZone,
      allDay: values.allDay,
      customerId: values.customerId,
    };

    try {
      if (isNew) {
        await createEvent.mutateAsync({
          data: {
            ...payload,
            attendees: values.attendeeIds.map((userId) => ({ userId })),
            reminders: values.reminders.map((minutesBefore) => ({ minutesBefore })),
          },
        });
      } else {
        await updateEvent.mutateAsync({ id: event.id, data: payload });
        // Учасники й нагадування — окремі під-ресурси: перші сервер ДИФАЄ (щоб не
        // спамити запрошеннями), другі персональні. Відправляємо лише те, що
        // справді змінилось — інакше кожне збереження чіпало б чужий стан
        if (!sameSet(values.attendeeIds, event.attendees.map((a) => a.user.id))) {
          await setAttendees.mutateAsync({
            id: event.id,
            data: { attendees: values.attendeeIds.map((userId) => ({ userId })) },
          });
        }
        if (!sameSet(
          values.reminders.map(String),
          event.reminders.map((reminder) => String(reminder.minutesBefore)),
        )) {
          await setReminders.mutateAsync({
            id: event.id,
            data: { reminders: values.reminders.map((minutesBefore) => ({ minutesBefore })) },
          });
        }
      }
      await invalidate();
      onClose();
    } catch (error) {
      applyServerError(error, form);
    }
  });

  const kindOptions = (['MEETING', 'CALL', 'DEADLINE', 'OUT_OF_OFFICE', 'OTHER'] as const).map(
    (kind) => ({ id: kind, label: t(`kind.${kind}`) }),
  );

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>{isNew ? t('form.createTitle') : event.title}</SheetTitle>
          <SheetDescription>
            {isNew
              ? t('form.createHint')
              : `${formatDateTime(event.startsAt, timeZone)} · ${timeZone}`}
          </SheetDescription>
        </SheetHeader>

        {/* Вкладки лишились (як на картці кастомера): подія має власну стрічку
            подій, і саме через неї видно, хто і коли її переносив */}
        <Tabs defaultValue="details" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-4">
            <TabsTrigger value="details">{t('form.tabDetails')}</TabsTrigger>
            {!isNew && <TabsTrigger value="activity">{t('form.tabActivity')}</TabsTrigger>}
          </TabsList>

          <TabsContent value="details" className="min-h-0 flex-1 overflow-y-auto">
            <form
              className="flex flex-col gap-4 p-4"
              onSubmit={(e) => void onSubmit(e)}
              noValidate
            >
              {/* RSVP — перше, що бачить запрошений: рішення в два кліки */}
              {!isNew && event.myResponse !== null && !event.isOrganizer && (
                <Field>
                  <FieldLabel htmlFor="calendar-rsvp-comment">{t('rsvp.question')}</FieldLabel>
                  <div className="flex items-center gap-2">
                    {(['ACCEPTED', 'TENTATIVE', 'DECLINED'] as const).map((response) => (
                      <Button
                        key={response}
                        type="button"
                        size="sm"
                        variant={event.myResponse === response ? 'default' : 'outline'}
                        disabled={setRsvp.isPending}
                        onClick={() => {
                          void (async () => {
                            // Примітка їде РАЗОМ із відповіддю: окремої кнопки
                            // «зберегти нотатку» немає свідомо — сервер порівнює
                            // обидва поля і no-op-ить, лише якщо не змінилось
                            // жодне, тож повторний клік по вже вибраній відповіді
                            // оновлює саму примітку
                            await setRsvp.mutateAsync({
                              id: event.id,
                              data: { response, comment: rsvpComment },
                            });
                            await invalidate();
                          })();
                        }}
                      >
                        {t(`rsvp.${response}`)}
                      </Button>
                    ))}
                  </div>
                  <Input
                    id="calendar-rsvp-comment"
                    value={rsvpComment}
                    maxLength={500}
                    placeholder={t('rsvp.commentPlaceholder')}
                    onChange={(e) => {
                      setRsvpComment(e.target.value);
                    }}
                  />
                  <FieldDescription>{t('rsvp.commentHint')}</FieldDescription>
                </Field>
              )}

              <FieldGroup>
                <FormTextField
                  control={control}
                  name="title"
                  label={t('form.title')}
                  placeholder={t('form.titlePlaceholder')}
                  disabled={!canEdit}
                />

                <Field orientation="horizontal">
                  <FieldLabel htmlFor="calendar-all-day">{t('form.allDay')}</FieldLabel>
                  <Switch
                    id="calendar-all-day"
                    checked={allDay}
                    disabled={!canEdit}
                    onCheckedChange={(checked: boolean) => {
                      setValue('allDay', checked, { shouldDirty: true });
                    }}
                  />
                </Field>

                {/* Дата окремим рядком, час — двома половинами під нею.
                    Спіймано в браузері: у трьохколонковій розкладці нативні
                    `type="time"` отримували 77px і показували «14:» замість
                    «14:00» (значення було правильне, обрізався рендер) */}
                {allDay ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field>
                      <FieldLabel htmlFor="calendar-date">{t('form.date')}</FieldLabel>
                      <Input
                        id="calendar-date"
                        type="date"
                        disabled={!canEdit}
                        {...form.register('date')}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="calendar-end-date">{t('form.endDate')}</FieldLabel>
                      <Input
                        id="calendar-end-date"
                        type="date"
                        disabled={!canEdit}
                        {...form.register('endDate')}
                      />
                    </Field>
                  </div>
                ) : (
                  <>
                    <Field>
                      <FieldLabel htmlFor="calendar-date">{t('form.date')}</FieldLabel>
                      <Input
                        id="calendar-date"
                        type="date"
                        disabled={!canEdit}
                        {...form.register('date')}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field>
                        <FieldLabel htmlFor="calendar-start-time">{t('form.from')}</FieldLabel>
                        {/* Нативний `type="time"`, а не власний слот-комбобокс:
                            браузер сам дає локальний 12/24-годинний формат,
                            клавіатурний ввід і мобільний пікер. Комбобокс зі
                            слотами по 15 хв — полірувка CAL-2 */}
                        <Input
                          id="calendar-start-time"
                          type="time"
                          step={900}
                          disabled={!canEdit}
                          {...form.register('startTime')}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="calendar-end-time">{t('form.to')}</FieldLabel>
                        <Input
                          id="calendar-end-time"
                          type="time"
                          step={900}
                          disabled={!canEdit}
                          {...form.register('endTime')}
                        />
                      </Field>
                    </div>
                  </>
                )}

                <FormSelect
                  control={control}
                  name="kind"
                  label={t('form.kind')}
                  options={kindOptions}
                />

                <Field>
                  <FieldLabel htmlFor="calendar-customer">{t('form.customer')}</FieldLabel>
                  <CustomerSelect
                    id="calendar-customer"
                    value={watch('customerId')}
                    disabled={!canEdit}
                    onChange={(customerId) => {
                      setValue('customerId', customerId, { shouldDirty: true });
                    }}
                  />
                </Field>

                <AttendeePicker
                  value={watch('attendeeIds')}
                  known={event?.attendees ?? []}
                  ownerId={event?.ownerId ?? null}
                  disabled={!canEdit}
                  onChange={(next) => {
                    setValue('attendeeIds', next, { shouldDirty: true });
                  }}
                />

                <ReminderRows
                  value={watch('reminders')}
                  onChange={(next) => {
                    setValue('reminders', next, { shouldDirty: true });
                  }}
                />

                <FormTextField
                  control={control}
                  name="location"
                  label={t('form.location')}
                  disabled={!canEdit}
                />
                <FormTextareaField
                  control={control}
                  name="description"
                  label={t('form.description')}
                  disabled={!canEdit}
                />

                <Field orientation="horizontal">
                  <FieldLabel htmlFor="calendar-private">{t('form.private')}</FieldLabel>
                  <Switch
                    id="calendar-private"
                    checked={watch('isPrivate')}
                    disabled={!canEdit}
                    onCheckedChange={(checked: boolean) => {
                      setValue('isPrivate', checked, { shouldDirty: true });
                    }}
                  />
                </Field>
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="calendar-busy">{t('form.busy')}</FieldLabel>
                  <Switch
                    id="calendar-busy"
                    checked={watch('busy')}
                    disabled={!canEdit}
                    onCheckedChange={(checked: boolean) => {
                      setValue('busy', checked, { shouldDirty: true });
                    }}
                  />
                </Field>
              </FieldGroup>

              {errors.root?.server && (
                <p className="text-sm text-destructive">{errors.root.server.message}</p>
              )}

              {/* Учасники бачать склад і свій RSVP, але не форму: редагує
                  організатор (сервер відповідає 403, і кнопки тут просто немає) */}
              {canEdit && (
                <div className="flex items-center justify-between gap-2 border-t pt-4">
                  <div className="flex items-center gap-2">
                    {!isNew && event.status !== 'CANCELLED' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={setStatus.isPending}
                        onClick={() => {
                          void (async () => {
                            await setStatus.mutateAsync({
                              id: event.id,
                              data: { status: 'CANCELLED' },
                            });
                            await invalidate();
                            onClose();
                          })();
                        }}
                      >
                        <CalendarOffIcon />
                        {t('form.cancelEvent')}
                      </Button>
                    )}
                    {!isNew && event.status === 'CANCELLED' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void (async () => {
                            await setStatus.mutateAsync({
                              id: event.id,
                              data: { status: 'CONFIRMED' },
                            });
                            await invalidate();
                          })();
                        }}
                      >
                        {t('form.restoreEvent')}
                      </Button>
                    )}
                    {!isNew && <DeleteEventButton onConfirm={async () => {
                      await removeEvent.mutateAsync({ id: event.id });
                      await invalidate();
                      onClose();
                    }} />}
                  </div>
                  <Button type="submit" disabled={isSubmitting}>
                    {isNew ? t('form.create') : t('form.save')}
                  </Button>
                </div>
              )}
            </form>
          </TabsContent>

          {!isNew && (
            <TabsContent value="activity" className="min-h-0 flex-1 overflow-y-auto">
              <div className="p-4">
                {/* Стрічка події — той самий спільний ActivityFeed, що на картках
                    юзера й кастомера. Нового ендпоінта не потрібно взагалі */}
                <ActivityFeed entityType="calendar_event" entityId={event.id} />
              </div>
            </TabsContent>
          )}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function DeleteEventButton({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const { t } = useTranslation('calendar');
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>
        <TrashIcon />
        {t('form.delete')}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('form.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('form.deleteHint')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('form.deleteCancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void onConfirm();
            }}
          >
            {t('form.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const set = new Set(right);
  return left.every((item) => set.has(item));
}

function emptyValues(
  timeZone: string,
  durationMinutes: number,
  reminderMinutes: number | null,
): FormValues {
  const now = new Date();
  return draftValues(
    { startsAt: now, endsAt: new Date(now.getTime() + durationMinutes * 60_000) },
    timeZone,
    durationMinutes,
    reminderMinutes,
  );
}

function draftValues(
  draft: EventSheetTarget['draft'],
  timeZone: string,
  durationMinutes: number,
  reminderMinutes: number | null,
): FormValues {
  const startsAt = draft?.startsAt ?? new Date();
  const endsAt = draft?.endsAt ?? new Date(startsAt.getTime() + durationMinutes * 60_000);
  const date = dayKey(startsAt, timeZone);
  return {
    title: '',
    allDay: false,
    date,
    endDate: date,
    startTime: timeOf(toInstantIso(startsAt), timeZone),
    endTime: timeOf(toInstantIso(endsAt), timeZone),
    kind: 'MEETING',
    location: '',
    description: '',
    customerId: draft?.customerId ?? null,
    isPrivate: false,
    busy: true,
    attendeeIds: [],
    reminders: reminderMinutes === null ? [] : [reminderMinutes],
  };
}

function valuesOf(event: CalendarEventResponse, timeZone: string): FormValues {
  // All-day читається в зоні ПОДІЇ (§6.2) — інакше редагування зсунуло б дату
  const zone = event.allDay ? event.timeZone : timeZone;
  return {
    title: event.title,
    allDay: event.allDay,
    date: dayKey(event.startsAt, zone),
    endDate: event.allDay ? inclusiveEndKey(event, zone) : dayKey(event.endsAt, zone),
    startTime: timeOf(event.startsAt, zone),
    endTime: timeOf(event.endsAt, zone),
    kind: event.kind,
    location: event.location ?? '',
    description: event.description ?? '',
    customerId: event.customerId,
    isPrivate: event.visibility === 'PRIVATE',
    busy: event.busy,
    attendeeIds: event.attendees.map((attendee) => attendee.user.id),
    reminders: event.reminders.map((reminder) => reminder.minutesBefore),
  };
}
