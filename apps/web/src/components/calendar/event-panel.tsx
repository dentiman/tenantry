import { useEffect, useState } from 'react';
import { TZDate } from '@date-fns/tz';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { CalendarOffIcon, TrashIcon, TriangleAlertIcon } from 'lucide-react';
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
import { Alert, AlertDescription, AlertTitle } from '@saas-skeleton/ui/components/ui/alert';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@saas-skeleton/ui/components/ui/field';
import { Input } from '@saas-skeleton/ui/components/ui/input';
import { Switch } from '@saas-skeleton/ui/components/ui/switch';
import { ContextPanelHeader } from '@saas-skeleton/ui/components/context-panel-slot';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import {
  getCalendarAgendaQueryKey,
  getCalendarFindWindowQueryKey,
  useCalendarCreate,
  useCalendarFindWindow,
  useCalendarRemove,
  useCalendarSetAttendees,
  useCalendarSetReminders,
  useCalendarSetRsvp,
  useCalendarSetStatus,
  useCalendarUpdate,
} from '../../api/generated/api';
import { ActivityFeed } from '../activity/activity-feed';
import { useAuthStore } from '../../stores/auth.store';
import {
  applyServerError,
  FormDateField,
  FormSelect,
  FormTextField,
  FormTextareaField,
} from '../form';
import { AttendeePicker } from './attendee-picker';
import { CustomerSelect } from './customer-select';
import { ReminderRows } from './reminder-rows';
import { findConflicts } from './find-conflicts';
import {
  asWeekStart,
  dayKey,
  formatTime,
  formatDateTime,
  toInstantIso,
} from '../../lib/calendar-date';

/**
 * Форма події. Схема ЛОКАЛЬНА, а не з `contracts`, свідомо: у формі час живе
 * трьома полями (`date` + `startTime` + `endTime`), бо саме так його вводить
 * людина, а контракт бере ISO-інстанти. Перетворення одне й у одному місці —
 * `toIso` нижче.
 */
const FormSchema = z.object({
  title: z.string().trim().min(1),
  allDay: z.boolean(),
  /*
   * Рядок, а не `string | null`: очищене поле дає тут `''` (див. `emptyValue`
   * на `FormDateField` нижче). Так `.min(1)` лишається робочим повідомленням
   * «дата обов'язкова», а `toIso` ніколи не бачить `null`.
   */
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

export interface EventPanelTarget {
  /** Наявна подія або чернетка з передзаповненим часом */
  event: CalendarEventResponse | null;
  draft?: {
    startsAt: Date;
    endsAt: Date;
    customerId?: string | null;
    /**
     * Подія-джерело для «Duplicate»: форма відкривається як НОВА, але з усіма
     * полями оригіналу (включно з учасниками й нагадуваннями). Саме `template`,
     * а не `event`: id, статус і RSVP не копіюються — дублікат не успадковує ні
     * історії оригіналу, ні відповідей його гостей
     */
    template?: CalendarEventResponse;
  };
}

interface EventPanelProps {
  target: EventPanelTarget | null;
  timeZone: string;
  /** Перший день тижня для міні-календаря в полях дати — той самий, що в сітці */
  weekStartsOn: number;
  defaultDurationMinutes: number;
  defaultReminderMinutes: number | null;
  onClose: () => void;
}

export function EventPanel({
  target,
  timeZone,
  weekStartsOn,
  defaultDurationMinutes,
  defaultReminderMinutes,
  onClose,
}: EventPanelProps) {
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
  const startDate = watch('date');
  const conflicts = useConflicts({
    isOpen: target !== null,
    allDay,
    date: startDate,
    startTime: watch('startTime'),
    endTime: watch('endTime'),
    timeZone,
    excludeId: event?.id ?? null,
  });

  // Форма перезаряджається на кожну зміну цілі: між двома подіями компонент не
  // розмонтовується (портал лишається на місці, міняється лише `target`), тому
  // без цього друга подія показувала б поля першої
  useEffect(() => {
    if (!target) {
      return;
    }
    reset(
      target.event
        ? valuesOf(target.event, timeZone)
        : target.draft?.template
          ? // Дублікат: поля оригіналу + межі з чернетки (у V1 вони збігаються,
            // але саме чернетка лишається джерелом правди про час)
            {
              ...valuesOf(target.draft.template, timeZone),
              ...pickDates(target.draft, timeZone, target.draft.template.allDay),
            }
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
        if (
          !sameSet(
            values.attendeeIds,
            event.attendees.map((a) => a.user.id),
          )
        ) {
          await setAttendees.mutateAsync({
            id: event.id,
            data: { attendees: values.attendeeIds.map((userId) => ({ userId })) },
          });
        }
        if (
          !sameSet(
            values.reminders.map(String),
            event.reminders.map((reminder) => String(reminder.minutesBefore)),
          )
        ) {
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
    // Панель, а не `Sheet`: сітка календаря лишається видимою і робочою поруч,
    // тому подію можна звірити з сусідніми, не закриваючи форму. Вміст їде в
    // третю колонку шела через `ContextPanelPortal` у сторінці-споживачі
    <div className="flex min-h-0 flex-1 flex-col">
      <ContextPanelHeader
        title={isNew ? t('form.createTitle') : event.title}
        description={
          isNew ? t('form.createHint') : `${formatDateTime(event.startsAt, timeZone)} · ${timeZone}`
        }
        onClose={onClose}
      />

      {/* Вкладки лишились (як на картці кастомера): подія має власну стрічку
            подій, і саме через неї видно, хто і коли її переносив */}
      <Tabs defaultValue="details" className="flex min-h-0 flex-1 flex-col">
        {/* `mx-2` — метрика полів панелі (удвічі тісніша за сторінку), `mt-2` —
            зазор під межею шапки: впритул таби читались як її частина (у `Sheet`
            цей зазор давав `gap-4` попапа) */}
        <TabsList className="mx-2 mt-2">
          <TabsTrigger value="details">{t('form.tabDetails')}</TabsTrigger>
          {!isNew && <TabsTrigger value="activity">{t('form.tabActivity')}</TabsTrigger>}
        </TabsList>

        {/* `ScrollArea`, а не нативний `overflow-y-auto`: смуга лежить ПОВЕРХ
            форми і зникає, коли нею не користуються — у 288px колонці постійна
            смуга відбирала б у полів ще 8px (з 272 доступних). Осі `vertical`
            досить: горизонтального скролу в панелі не буває за політикою, і
            примітив глушить його сам — раніше тут стояв ручний
            `overflow-x-hidden` проти фантомних пікселів `Switch`
            (`docs/frontend/ui-known-issues.md` UI-2) */}
        <TabsContent value="details" className="flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            {/* `p-2` — поля ПАНЕЛІ, а не сторінки: 8px замість 16px. У 288px
              колонці кожні 8px по краях це 6% ширини поля вводу, і повні поля
              сторінки з'їдали більше, ніж давали (докладніше — §5.6
              `docs/frontend/app-shell.md`) */}
            <form className="flex flex-col gap-4 p-2" onSubmit={(e) => void onSubmit(e)} noValidate>
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
                  /* Дві дати ОДНА ПІД ОДНОЮ, а не в два стовпці: у панелі 288px
                     колонка виходить ~130px, а `2026-09-09` разом зі знаком
                     календаря в неї не влазить — рівно та сама історія, що з
                     нативним `type="time"` вище, тільки спіймана до релізу */
                  <>
                    <FormDateField
                      control={control}
                      name="date"
                      label={t('form.date')}
                      disabled={!canEdit}
                      emptyValue=""
                      weekStartsOn={asWeekStart(weekStartsOn)}
                    />
                    {/* Останній день не може передувати першому — межу тримає
                        сам календар, а не перевірка після submit */}
                    <FormDateField
                      control={control}
                      name="endDate"
                      label={t('form.endDate')}
                      disabled={!canEdit}
                      emptyValue=""
                      min={startDate || undefined}
                      weekStartsOn={asWeekStart(weekStartsOn)}
                    />
                  </>
                ) : (
                  <>
                    <FormDateField
                      control={control}
                      name="date"
                      label={t('form.date')}
                      disabled={!canEdit}
                      emptyValue=""
                      weekStartsOn={asWeekStart(weekStartsOn)}
                    />
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
                    {conflicts.length > 0 && (
                      // ПОПЕРЕДЖЕННЯ, а не помилка: збереження не блокується, тому
                      // це `Alert` під полями часу, а не `FieldError` і не
                      // `errors.root` — форма лишається валідною. Варіант
                      // `warning` зі смужкою — та сама форма, що банер зони на
                      // сторінці календаря: мова попереджень у модулі одна
                      <Alert variant="warning" accent="left">
                        <TriangleAlertIcon />
                        <AlertTitle>{t('conflicts.title', { count: conflicts.length })}</AlertTitle>
                        <AlertDescription>
                          <ul className="list-none">
                            {conflicts.slice(0, CONFLICTS_SHOWN).map((conflict) => (
                              <li key={conflict.id} className="truncate">
                                {formatTime(conflict.startsAt, timeZone)}
                                {' – '}
                                {formatTime(conflict.endsAt, timeZone)} · {conflict.title}
                              </li>
                            ))}
                            {conflicts.length > CONFLICTS_SHOWN && (
                              <li>
                                {t('conflicts.more', {
                                  count: conflicts.length - CONFLICTS_SHOWN,
                                })}
                              </li>
                            )}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}
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
                // Стовпчик, а не рядок із `justify-between`: три кнопки
                // (Cancel event + Delete + Save) у 288px колонці не вміщались і
                // ВИШТОВХУВАЛИ панель — саме вони давали горизонтальний скрол
                // (спіймано в браузері 2026-09-08). У вузькій панелі головна дія
                // йде на всю ширину зверху, вторинні — рядком під нею з переносом
                <div className="flex flex-col gap-2 border-t pt-4">
                  <Button type="submit" disabled={isSubmitting}>
                    {isNew ? t('form.create') : t('form.save')}
                  </Button>
                  <div className="flex flex-wrap items-center gap-2">
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
                    {!isNew && (
                      <DeleteEventButton
                        onConfirm={async () => {
                          await removeEvent.mutateAsync({ id: event.id });
                          await invalidate();
                          onClose();
                        }}
                      />
                    )}
                  </div>
                </div>
              )}
            </form>
          </ScrollArea>
        </TabsContent>

        {!isNew && (
          <TabsContent value="activity" className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-2">
                {/* Стрічка події — той самий спільний ActivityFeed, що на картках
                    юзера й кастомера. Нового ендпоінта не потрібно взагалі */}
                <ActivityFeed entityType="calendar_event" entityId={event.id} />
              </div>
            </ScrollArea>
          </TabsContent>
        )}
      </Tabs>
    </div>
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
  draft: EventPanelTarget['draft'],
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

/** Дата й час із чернетки у форматі полів форми */
function pickDates(
  draft: { startsAt: Date; endsAt: Date },
  timeZone: string,
  allDay: boolean,
): Pick<FormValues, 'date' | 'endDate' | 'startTime' | 'endTime'> {
  const date = dayKey(draft.startsAt, timeZone);
  return {
    date,
    // All-day кінець у моделі ексклюзивний, а в полі — останній день ВКЛЮЧНО
    endDate: allDay
      ? dayKey(new Date(draft.endsAt.getTime() - 86_400_000), timeZone)
      : dayKey(draft.endsAt, timeZone),
    startTime: timeOf(draft.startsAt.toISOString(), timeZone),
    endTime: timeOf(draft.endsAt.toISOString(), timeZone),
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

/** Скільки конфліктів показуємо списком, доки решта не згорнеться в «+N» */
const CONFLICTS_SHOWN = 3;

/**
 * Конфлікти для поточних значень форми.
 *
 * Вікно — РІВНО одна доба, а не тиждень сторінки: подія редагується в межах дня
 * (багатоденну робить кінцева дата, і там попередження втрачає сенс), а окремий
 * ключ кешу на добу перевикористовується між відкриттями панелі. Дані беруться
 * тим самим `GET /calendar/events`, чий дефолт `mine` — «де я організатор або
 * учасник»: конфлікт — це моя зайнятість, а не чиясь.
 */
function useConflicts({
  isOpen,
  allDay,
  date,
  startTime,
  endTime,
  timeZone,
  excludeId,
}: {
  isOpen: boolean;
  allDay: boolean;
  date: string;
  startTime: string;
  endTime: string;
  timeZone: string;
  excludeId: string | null;
}): { id: string; title: string; startsAt: string; endsAt: string }[] {
  const isReady = isOpen && !allDay && date !== '' && startTime !== '' && endTime !== '';
  const dayStart = isReady ? toIso(date, '00:00', timeZone) : '';
  const dayEnd = isReady ? nextDayIso(date, timeZone) : '';

  const { data } = useCalendarFindWindow(
    { from: dayStart, to: dayEnd },
    // Порожні межі до готовності форми не відправляємо: контракт вимагає ISO,
    // і `enabled` тут не косметика, а умова коректності запиту
    { query: { enabled: isReady } },
  );

  if (!isReady || !data) {
    return [];
  }
  return findConflicts(
    { startsAt: toIso(date, startTime, timeZone), endsAt: toIso(date, endTime, timeZone) },
    data.items,
    excludeId,
  );
}
