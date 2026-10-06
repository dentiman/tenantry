import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { DatePicker } from '@saas-skeleton/ui/components/date-picker';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Field, FieldLabel } from '@saas-skeleton/ui/components/ui/field';
import { Input } from '@saas-skeleton/ui/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@saas-skeleton/ui/components/ui/select';
import { todayValue } from '@saas-skeleton/ui/lib/date-value';
import { ShowcaseCard, ValueReadout } from '../components/showcase';

interface InlineFilters {
  date: string | null;
  owner: string;
  query: string;
}

const EMPTY: InlineFilters = { date: null, owner: 'any', query: '' };

/**
 * Стенд «форма-рядок»: кілька полів в ОДНОМУ рядку плюс дія — фільтр-бар над
 * списком, панель параметрів звіту, рядок швидкого створення.
 *
 * Рядок жорсткіший за стовпчик рівно двома речами, і саме їх тут і перевіряють:
 * поле мусить мати власну розумну ширину (у стовпчику її задає колонка) і
 * мусить пережити перенос на вузькій ширині, не розсипавши підписи.
 */
export function PlaygroundInlineFormPage() {
  const { t } = useTranslation('playground');
  const [filters, setFilters] = useState<InlineFilters>({ ...EMPTY, date: todayValue() });
  const [applied, setApplied] = useState<InlineFilters | null>(null);
  const [narrowDate, setNarrowDate] = useState<string | null>(todayValue());
  const [besideDate, setBesideDate] = useState<string | null>(null);

  const ownerOptions = [
    { id: 'any', label: t('forms.owners.any') },
    { id: 'me', label: t('forms.owners.me') },
    { id: 'team', label: t('forms.owners.team') },
  ];

  const ownerSelect = (
    <Select
      items={ownerOptions.map((option) => ({ value: option.id, label: option.label }))}
      value={filters.owner}
      onValueChange={(value: string | null) => {
        setFilters((prev) => ({ ...prev, owner: value ?? 'any' }));
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {ownerOptions.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageBreadcrumbs
        items={[{ label: t('title'), to: '/playground' }, { label: t('inlineForm.title') }]}
      />

      <header className="mb-10 max-w-3xl">
        <Badge variant="secondary">{t('eyebrow')}</Badge>
        <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-foreground">
          {t('inlineForm.title')}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          {t('inlineForm.description')}
        </p>
      </header>

      <div className="space-y-6">
        <ShowcaseCard
          id="inline-labelled"
          title={t('inlineForm.sections.labelled.title')}
          description={t('inlineForm.sections.labelled.description')}
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setApplied(filters);
              }}
              noValidate
            >
              {/* `flex-1 basis-*` замість фіксованої ширини: у рядку поле мусить
                  віддавати зайве сусідам і не падати нижче читабельного мінімуму */}
              <Field className="w-auto flex-1 basis-56">
                <FieldLabel htmlFor="inline-query">{t('forms.fields.query')}</FieldLabel>
                <Input
                  id="inline-query"
                  value={filters.query}
                  placeholder={t('forms.placeholders.query')}
                  onChange={(event) => {
                    setFilters((prev) => ({ ...prev, query: event.target.value }));
                  }}
                />
              </Field>
              <Field className="w-auto flex-1 basis-44">
                <FieldLabel htmlFor="inline-date">{t('forms.fields.date')}</FieldLabel>
                <DatePicker
                  id="inline-date"
                  value={filters.date}
                  onValueChange={(date) => {
                    setFilters((prev) => ({ ...prev, date }));
                  }}
                />
              </Field>
              <Field className="w-auto flex-1 basis-40">
                <FieldLabel>{t('forms.fields.owner')}</FieldLabel>
                {ownerSelect}
              </Field>
              <div className="flex gap-2">
                <Button type="submit">{t('forms.actions.apply')}</Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setFilters(EMPTY);
                    setApplied(null);
                  }}
                >
                  {t('forms.actions.reset')}
                </Button>
              </div>
            </form>
            <ValueReadout label={t('forms.applied')} value={applied} />
          </div>
        </ShowcaseCard>

        <ShowcaseCard
          id="inline-toolbar"
          title={t('inlineForm.sections.toolbar.title')}
          description={t('inlineForm.sections.toolbar.description')}
        >
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 p-4">
            <Input
              className="w-56"
              aria-label={t('forms.fields.query')}
              placeholder={t('forms.placeholders.query')}
              value={filters.query}
              onChange={(event) => {
                setFilters((prev) => ({ ...prev, query: event.target.value }));
              }}
            />
            {/* Без лейбла роль поля пояснює лише плейсхолдер, тому маска формату
                тут особливо доречна: `mm/dd/yyyy` читається як «сюди дату» */}
            <div className="w-44">
              <DatePicker
                value={filters.date}
                onValueChange={(date) => {
                  setFilters((prev) => ({ ...prev, date }));
                }}
              />
            </div>
            <div className="w-40">{ownerSelect}</div>
            <Button variant="secondary">{t('forms.actions.apply')}</Button>
          </div>
        </ShowcaseCard>

        <ShowcaseCard
          id="inline-narrow"
          title={t('inlineForm.sections.narrow.title')}
          description={t('inlineForm.sections.narrow.description')}
        >
          <div className="max-w-sm rounded-xl bg-muted/50 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-auto flex-1 basis-44">
                <FieldLabel htmlFor="narrow-date">{t('forms.fields.date')}</FieldLabel>
                <DatePicker id="narrow-date" value={narrowDate} onValueChange={setNarrowDate} />
              </Field>
              <Field className="w-auto flex-1 basis-40">
                <FieldLabel>{t('forms.fields.owner')}</FieldLabel>
                {ownerSelect}
              </Field>
              <Button type="button">{t('forms.actions.apply')}</Button>
            </div>
          </div>
        </ShowcaseCard>

        <ShowcaseCard
          id="inline-beside"
          title={t('inlineForm.sections.beside.title')}
          description={t('inlineForm.sections.beside.description')}
        >
          <div className="max-w-xl space-y-4">
            <Field orientation="horizontal">
              <FieldLabel htmlFor="beside-date">{t('forms.fields.startDate')}</FieldLabel>
              <DatePicker id="beside-date" value={besideDate} onValueChange={setBesideDate} />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel>{t('forms.fields.owner')}</FieldLabel>
              {ownerSelect}
            </Field>
          </div>
        </ShowcaseCard>
      </div>
    </div>
  );
}
