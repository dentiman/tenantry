import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { DatePicker } from '@saas-skeleton/ui/components/date-picker';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { FieldGroup } from '@saas-skeleton/ui/components/ui/field';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@saas-skeleton/ui/components/ui/table';
import { dateInputMask, todayValue } from '@saas-skeleton/ui/lib/date-value';
import {
  ExampleTile,
  ShowcaseCard,
  ValueReadout,
} from '../components/playground/showcase';
import {
  FormDateField,
  FormSelect,
  FormTextareaField,
  FormTextField,
} from '../components/form';

/**
 * Стенд «форма-стовпчик» — дефолтна розкладка продукту: одна колонка, лейбл над
 * контролом, ширина обмежена читабельністю рядка, а не шириною екрана.
 *
 * Форма тут ЖИВА (react-hook-form + zod), а не мальована: поле дати треба
 * прощупати саме в тому оточенні, де воно працюватиме — з валідацією, з
 * залежністю однієї дати від іншої і з видимим результатом submit-у.
 */
const DemoFormSchema = z
  .object({
    title: z.string().min(2),
    owner: z.string().min(1),
    startDate: z.string().min(1),
    dueDate: z.string().nullable(),
    notes: z.string(),
  })
  .refine((value) => !value.dueDate || value.dueDate >= value.startDate, {
    // Порівняння РЯДКІВ, а не дат: `yyyy-MM-dd` лексикографічно впорядкований
    // так само, як хронологічно — це і є друга причина тримати дату рядком
    path: ['dueDate'],
    message: 'Due date cannot be earlier than the start date',
  });

type DemoForm = z.infer<typeof DemoFormSchema>;

export function PlaygroundVerticalFormPage() {
  const { t } = useTranslation('playground');
  const [submitted, setSubmitted] = useState<DemoForm | null>(null);
  const [standalone, setStandalone] = useState<string | null>(todayValue());
  const [birthday, setBirthday] = useState<string | null>(null);

  const form = useForm<DemoForm>({
    resolver: zodResolver(DemoFormSchema),
    defaultValues: { title: '', owner: 'me', startDate: todayValue(), dueDate: null, notes: '' },
  });

  const startDate = form.watch('startDate');

  const onSubmit = form.handleSubmit((values) => {
    setSubmitted(values);
  });

  const ownerOptions = [
    { id: 'me', label: t('forms.owners.me') },
    { id: 'team', label: t('forms.owners.team') },
    { id: 'unassigned', label: t('forms.owners.unassigned') },
  ];

  const acceptedInputs = [
    { input: '2026-09-09', note: t('datePicker.accepts.iso') },
    { input: '9/9/2026', note: t('datePicker.accepts.localeOrder') },
    { input: '9/9', note: t('datePicker.accepts.noYear') },
    { input: '9', note: t('datePicker.accepts.dayOnly') },
    { input: '20260909', note: t('datePicker.accepts.compact') },
    { input: 'Sep 9 2026', note: t('datePicker.accepts.namedMonth') },
    { input: '31/02/2026', note: t('datePicker.accepts.invalid') },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageBreadcrumbs
        items={[{ label: t('title'), to: '/playground' }, { label: t('verticalForm.title') }]}
      />

      <header className="mb-10 max-w-3xl">
        <Badge variant="secondary">{t('eyebrow')}</Badge>
        <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-foreground">
          {t('verticalForm.title')}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          {t('verticalForm.description')}
        </p>
      </header>

      <div className="space-y-6">
        <ShowcaseCard
          id="vertical-live"
          title={t('verticalForm.sections.live.title')}
          description={t('verticalForm.sections.live.description')}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <form className="max-w-md" onSubmit={(e) => void onSubmit(e)} noValidate>
              <FieldGroup>
                <FormTextField
                  control={form.control}
                  name="title"
                  label={t('forms.fields.title')}
                />
                <FormSelect
                  control={form.control}
                  name="owner"
                  label={t('forms.fields.owner')}
                  options={ownerOptions}
                />
                <FormDateField
                  control={form.control}
                  name="startDate"
                  label={t('forms.fields.startDate')}
                  description={t('verticalForm.startHint', { mask: dateInputMask() })}
                />
                {/* Межа другого поля — значення першого: класична пара дат, на
                    якій одразу видно і `min`, і повідомлення схеми */}
                <FormDateField
                  control={form.control}
                  name="dueDate"
                  label={t('forms.fields.dueDate')}
                  min={startDate || undefined}
                />
                <FormTextareaField
                  control={form.control}
                  name="notes"
                  label={t('forms.fields.notes')}
                  rows={3}
                />
                <div className="flex gap-2">
                  <Button type="submit">{t('forms.actions.submit')}</Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      form.reset();
                      setSubmitted(null);
                    }}
                  >
                    {t('forms.actions.reset')}
                  </Button>
                </div>
              </FieldGroup>
            </form>
            <ValueReadout label={t('forms.submitted')} value={submitted} />
          </div>
        </ShowcaseCard>

        <ShowcaseCard
          id="vertical-date-picker"
          title={t('datePicker.title')}
          description={t('datePicker.description')}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ExampleTile code="(default)" description={t('datePicker.tiles.iso')}>
              <div className="w-full">
                <DatePicker value={standalone} onValueChange={setStandalone} />
              </div>
            </ExampleTile>
            <ExampleTile code='format="long"' description={t('datePicker.tiles.long')}>
              <div className="w-full">
                <DatePicker value={standalone} onValueChange={setStandalone} format="long" />
              </div>
            </ExampleTile>
            <ExampleTile code='captionLayout="label"' description={t('datePicker.tiles.label')}>
              <div className="w-full">
                <DatePicker
                  value={standalone}
                  onValueChange={setStandalone}
                  captionLayout="label"
                />
              </div>
            </ExampleTile>
            <ExampleTile
              code="max={todayValue()}"
              description={t('datePicker.tiles.past')}
            >
              <div className="w-full">
                <DatePicker value={birthday} onValueChange={setBirthday} max={todayValue()} />
              </div>
            </ExampleTile>
            <ExampleTile code="disabled" description={t('datePicker.tiles.disabled')}>
              <div className="w-full">
                <DatePicker value={standalone} onValueChange={setStandalone} disabled />
              </div>
            </ExampleTile>
            <ExampleTile code='aria-invalid={true}' description={t('datePicker.tiles.invalid')}>
              <div className="w-full">
                <DatePicker value={standalone} onValueChange={setStandalone} aria-invalid />
              </div>
            </ExampleTile>
          </div>

          <div className="mt-6">
            <h3 className="mb-1 font-heading text-lg font-semibold tracking-tight text-foreground">
              {t('datePicker.accepts.title')}
            </h3>
            <p className="mb-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              {t('datePicker.accepts.description')}
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('datePicker.accepts.input')}</TableHead>
                  <TableHead>{t('datePicker.accepts.result')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {acceptedInputs.map((row) => (
                  <TableRow key={row.input}>
                    <TableCell>
                      <code>{row.input}</code>
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">
                      {row.note}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ShowcaseCard>
      </div>
    </div>
  );
}
