import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@saas-skeleton/ui/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@saas-skeleton/ui/components/ui/table';
import { ExampleTile, ShowcaseCard } from '../components/showcase';

/**
 * Каталожний стенд Select — випадаючий список на Base UI.
 *
 * Показуємо: голий контрол у базовому й компактному розмірах, стан з
 * placholder-ом, групи з Label/Separator, і «Raw usage» з реальних місць
 * продукту — reminder-рядів календаря (числові пресети), week-starts у
 * налаштуваннях календаря, фільтра-бара inline-форми. Значення — завжди
 * рядок (`value`/`onValueChange`), числові мусять конвертуватись на місці.
 */
/** Статичні приклади «Real usage» не змінюють вибір — це стенд, а не fільтр */
function noop(): void {
  return;
}

export function PlaygroundSelectPage() {
  const { t } = useTranslation('playground');

  const [owner, setOwner] = useState('any');
  const [grouped, setGrouped] = useState('billing');

  return (
    <div className="mx-auto max-w-7xl">
      <PageBreadcrumbs
        items={[
          { label: t('title'), to: '/playground' },
          { label: t('nav.components') },
          { label: t('nav.select') },
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
          {t('select.title')}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">{t('select.description')}</p>
      </header>

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="min-w-0 space-y-6">
          <section id="select-overview" className="scroll-mt-6">
            <div className="rounded-xl bg-muted/50 p-4">
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('select.importLabel')}
              </p>
              <code className="block overflow-x-auto font-mono text-xs leading-6 text-foreground">
                import{' '}
                {'{ Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem }'}{' '}
                from '@saas-skeleton/ui/components/ui/select';
              </code>
            </div>
          </section>

          <ShowcaseCard
            id="select-variants"
            title={t('select.sections.variants.title')}
            description={t('select.sections.variants.description')}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <ExampleTile
                code='size="default"'
                description={t('select.variants.default.description')}
              >
                <div className="flex w-full flex-col items-center gap-3">
                  <Select
                    items={[
                      { value: 'any', label: t('forms.owners.any') },
                      { value: 'me', label: t('forms.owners.me') },
                      { value: 'team', label: t('forms.owners.team') },
                    ]}
                    value={owner}
                    onValueChange={(next: string | null) => {
                      setOwner(next ?? 'any');
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {[
                          { value: 'any', label: t('forms.owners.any') },
                          { value: 'me', label: t('forms.owners.me') },
                          { value: 'team', label: t('forms.owners.team') },
                        ].map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <span className="text-center text-xs text-muted-foreground">
                    {t('select.sizes.default')}
                  </span>
                </div>
              </ExampleTile>
              <ExampleTile code='size="sm"' description={t('select.variants.sm.description')}>
                <div className="flex w-full flex-col items-center gap-3">
                  <Select
                    items={[
                      { value: 'day', label: t('tabs.labels.day') },
                      { value: 'week', label: t('tabs.labels.week') },
                      { value: 'month', label: t('tabs.labels.month') },
                    ]}
                    value="week"
                    onValueChange={noop}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {[
                          { value: 'day', label: t('tabs.labels.day') },
                          { value: 'week', label: t('tabs.labels.week') },
                          { value: 'month', label: t('tabs.labels.month') },
                        ].map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <span className="text-center text-xs text-muted-foreground">
                    {t('select.sizes.sm')}
                  </span>
                </div>
              </ExampleTile>
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="select-groups"
            title={t('select.sections.groups.title')}
            description={t('select.sections.groups.description')}
          >
            <ExampleTile code="SelectGroup + SelectLabel + SelectSeparator">
              <Select
                items={[
                  { value: 'billing', label: t('select.groups.billing') },
                  { value: 'shipping', label: t('select.groups.shipping') },
                  { value: 'general', label: t('select.groups.general') },
                ]}
                value={grouped}
                onValueChange={(next: string | null) => {
                  setGrouped(next ?? 'billing');
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t('select.groups.labelAddress')}</SelectLabel>
                    {[
                      { value: 'billing', label: t('select.groups.billing') },
                      { value: 'shipping', label: t('select.groups.shipping') },
                    ].map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                    <SelectSeparator />
                    <SelectItem value="general">{t('select.groups.general')}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </ExampleTile>
          </ShowcaseCard>

          <ShowcaseCard
            id="select-usage"
            title={t('select.sections.usage.title')}
            description={t('select.sections.usage.description')}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('select.usage.calendarReminders.title')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('select.usage.calendarReminders.description')}
                  </p>
                </div>
                <Select
                  items={[
                    { value: '0', label: t('select.usage.calendarReminders.atStart') },
                    { value: '5', label: '5 min' },
                    { value: '15', label: '15 min' },
                    { value: '30', label: '30 min' },
                  ]}
                  value="15"
                  onValueChange={noop}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {[
                        { value: '0', label: t('select.usage.calendarReminders.atStart') },
                        { value: '5', label: '5 min' },
                        { value: '15', label: '15 min' },
                        { value: '30', label: '30 min' },
                      ].map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
                  apps/web/src/components/calendar/reminder-rows.tsx
                </code>
              </div>

              <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('select.usage.weekStarts.title')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('select.usage.weekStarts.description')}
                  </p>
                </div>
                <Select
                  items={[
                    { value: '1', label: t('select.usage.weekStarts.monday') },
                    { value: '0', label: t('select.usage.weekStarts.sunday') },
                    { value: '6', label: t('select.usage.weekStarts.saturday') },
                  ]}
                  value="1"
                  onValueChange={noop}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {[
                        { value: '1', label: t('select.usage.weekStarts.monday') },
                        { value: '0', label: t('select.usage.weekStarts.sunday') },
                        { value: '6', label: t('select.usage.weekStarts.saturday') },
                      ].map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
                  apps/web/src/pages/settings/calendar.tsx
                </code>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('select.usage.filterBar.title')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('select.usage.filterBar.description')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  items={[
                    { value: 'any', label: t('forms.owners.any') },
                    { value: 'me', label: t('forms.owners.me') },
                    { value: 'team', label: t('forms.owners.team') },
                  ]}
                  value="any"
                  onValueChange={noop}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {[
                        { value: 'any', label: t('forms.owners.any') },
                        { value: 'me', label: t('forms.owners.me') },
                        { value: 'team', label: t('forms.owners.team') },
                      ].map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
                apps/web/src/pages/playground-inline-form.tsx
              </code>
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="select-interactivity"
            title={t('select.sections.interactivity.title')}
            description={t('select.sections.interactivity.description')}
          >
            <div className="flex flex-col items-start gap-3">
              <Select
                items={[
                  { value: 'one', label: t('select.interactivity.one') },
                  { value: 'two', label: t('select.interactivity.two') },
                  { value: 'three', label: t('select.interactivity.three') },
                ]}
                value="one"
                onValueChange={noop}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {[
                      { value: 'one', label: t('select.interactivity.one') },
                      { value: 'two', label: t('select.interactivity.two') },
                      { value: 'three', label: t('select.interactivity.three') },
                    ].map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('select.interactivity.hint')}</p>
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="select-api"
            title={t('select.sections.api.title')}
            description={t('select.sections.api.description')}
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
                    <code>size</code>
                  </TableCell>
                  <TableCell>
                    <code>default | sm</code>
                  </TableCell>
                  <TableCell>
                    <code>default</code>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('select.api.rows.size')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>value</code>
                  </TableCell>
                  <TableCell>
                    <code>string | null</code>
                  </TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('select.api.rows.value')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>onValueChange</code>
                  </TableCell>
                  <TableCell>
                    <code>(value: string | null) =&gt; void</code>
                  </TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('select.api.rows.onValueChange')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>items</code>
                  </TableCell>
                  <TableCell>
                    <code>{'{ value: string; label: string }[]'}</code>
                  </TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('select.api.rows.items')}
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
                    {t('select.api.rows.disabled')}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </ShowcaseCard>
        </div>

        <aside className="sticky top-6 hidden xl:block">
          <p className="mb-3 text-xs font-semibold tracking-wide text-foreground uppercase">
            {t('onThisPage')}
          </p>
          <nav aria-label={t('onThisPage')} className="space-y-1 border-l border-border pl-4">
            <a
              href="#select-overview"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('select.navigation.overview')}
            </a>
            <a
              href="#select-variants"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('select.navigation.variants')}
            </a>
            <a
              href="#select-groups"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('select.navigation.groups')}
            </a>
            <a
              href="#select-usage"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('select.navigation.usage')}
            </a>
            <a
              href="#select-interactivity"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('select.navigation.interactivity')}
            </a>
            <a
              href="#select-api"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('select.navigation.api')}
            </a>
          </nav>
        </aside>
      </div>
    </div>
  );
}
