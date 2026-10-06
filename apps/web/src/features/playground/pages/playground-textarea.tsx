import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@saas-skeleton/ui/components/ui/table';
import { Textarea } from '@saas-skeleton/ui/components/ui/textarea';
import { ExampleTile, ShowcaseCard, ValueReadout } from '../components/showcase';

/**
 * Каталожний стенд Textarea — багаторядкове текстове поле.
 *
 * У продукті textarea не використовується напряму жодного разу — тільки через
 * обгортку FormTextareaField (`libs/ui/components/form/form-textarea-field.tsx`),
 * тому стенд показує і сирий `<Textarea>`, і обгортку. Крім того textarea живе
 * всередині InputGroup (`InputGroupTextarea`) для багаторядкових адорнованих
 * полів — про це теж згадуємо в usage.
 */
export function PlaygroundTextareaPage() {
  const { t } = useTranslation('playground');

  const [value, setValue] = useState('');

  return (
    <div className="mx-auto max-w-7xl">
      <PageBreadcrumbs
        items={[
          { label: t('title'), to: '/playground' },
          { label: t('nav.components') },
          { label: t('nav.textarea') },
        ]}
      />

      <header className="mb-10 max-w-3xl">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{t('eyebrow')}</Badge>
          <Badge variant="outline" title={t('origin.changed.hint')}>
            {t('origin.changed.label')}
          </Badge>
        </div>
        <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-foreground">
          {t('textarea.title')}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          {t('textarea.description')}
        </p>
      </header>

      <div className="min-w-0 space-y-6">
        <section id="textarea-overview" className="scroll-mt-6">
          <div className="rounded-xl bg-muted/50 p-4">
            <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('textarea.importLabel')}
            </p>
            <code className="block overflow-x-auto font-mono text-xs leading-6 text-foreground">
              import {'{ Textarea }'} from '@saas-skeleton/ui/components/ui/textarea';
            </code>
          </div>
        </section>

        <ShowcaseCard
          id="textarea-states"
          title={t('textarea.sections.states.title')}
          description={t('textarea.sections.states.description')}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <ExampleTile code={t('textarea.states.disabled.code')}>
              <Textarea disabled placeholder={t('textarea.placeholders.disabled')} />
            </ExampleTile>
            <ExampleTile
              code={t('textarea.states.invalid.code')}
              description={t('textarea.states.invalid.description')}
            >
              <Textarea aria-invalid placeholder={t('textarea.placeholders.invalid')} />
            </ExampleTile>
          </div>
        </ShowcaseCard>

        <ShowcaseCard
          id="textarea-rows"
          title={t('textarea.sections.rows.title')}
          description={t('textarea.sections.rows.description')}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <ExampleTile
              code={`rows={2}\nfield-sizing`}
              description={t('textarea.rows.small.description')}
            >
              <Textarea rows={2} placeholder={t('textarea.placeholders.small')} />
            </ExampleTile>
            <ExampleTile code="rows={6}" description={t('textarea.rows.default.description')}>
              <Textarea rows={6} defaultValue={t('textarea.rows.default.sample')} />
            </ExampleTile>
          </div>
        </ShowcaseCard>

        <ShowcaseCard
          id="textarea-live"
          title={t('textarea.sections.live.title')}
          description={t('textarea.sections.live.description')}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <ExampleTile code="value + onChange">
              <div className="flex w-full flex-col gap-3">
                <Textarea
                  placeholder={t('textarea.live.placeholder')}
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                  }}
                />
                <ValueReadout label="value" value={value} />
              </div>
            </ExampleTile>
            <ExampleTile
              code="field-sizing-content"
              description={t('textarea.live.autoGrow.description')}
            >
              <Textarea
                placeholder={t('textarea.live.autoGrow.placeholder')}
                defaultValue={t('textarea.live.autoGrow.sample')}
                className="min-h-16"
              />
            </ExampleTile>
          </div>
        </ShowcaseCard>

        <ShowcaseCard
          id="textarea-usage"
          title={t('textarea.sections.usage.title')}
          description={t('textarea.sections.usage.description')}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('textarea.usage.wrapper.title')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('textarea.usage.wrapper.description')}
                </p>
              </div>
              <label htmlFor="wrapper-sample" className="text-sm font-medium text-foreground">
                {t('textarea.usage.wrapper.label')}
              </label>
              <Textarea
                id="wrapper-sample"
                rows={3}
                defaultValue={t('textarea.usage.wrapper.sample')}
              />
              <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
                FormTextareaField
              </code>
            </div>

            <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('textarea.usage.group.title')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('textarea.usage.group.description')}
                </p>
              </div>
              <textarea
                className="w-full rounded-lg border border-input bg-field px-3 py-2 min-h-16 text-sm text-foreground placeholder:text-muted-foreground"
                defaultValue={t('textarea.usage.group.sample')}
                rows={3}
              />
              <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
                InputGroupTextarea
              </code>
            </div>
          </div>
        </ShowcaseCard>

        <ShowcaseCard
          id="textarea-api"
          title={t('textarea.sections.api.title')}
          description={t('textarea.sections.api.description')}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('button.api.prop')}</TableHead>
                <TableHead>{t('button.api.type')}</TableHead>
                <TableHead>{t('button.api.default')}</TableHead>
                <TableHead>{t('button.api.description')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>
                  <code>rows</code>
                </TableCell>
                <TableCell>
                  <code>number</code>
                </TableCell>
                <TableCell>
                  <code>2</code>
                </TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">
                  {t('textarea.api.rows.rows')}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code>className</code>
                </TableCell>
                <TableCell>
                  <code>string</code>
                </TableCell>
                <TableCell>—</TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">
                  {t('textarea.api.rows.className')}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code>disabled</code>
                </TableCell>
                <TableCell>
                  <code>boolean</code>
                </TableCell>
                <TableCell>
                  <code>false</code>
                </TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">
                  {t('textarea.api.rows.disabled')}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code>aria-invalid</code>
                </TableCell>
                <TableCell>
                  <code>boolean</code>
                </TableCell>
                <TableCell>—</TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">
                  {t('textarea.api.rows.invalid')}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </ShowcaseCard>
      </div>
    </div>
  );
}
