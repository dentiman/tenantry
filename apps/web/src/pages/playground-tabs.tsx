import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@saas-skeleton/ui/components/ui/table';
import { ExampleTile, ShowcaseCard, ValueReadout } from '../components/playground/showcase';

const CALENDAR_VIEWS = ['day', 'week', 'month'] as const;
type CalendarViewSample = (typeof CALENDAR_VIEWS)[number];

/**
 * Другий каталожний стенд (після Buttons) — задає шаблон для решти
 * `/playground/components/*`: варіанти й розміри через самі пропси, а секція
 * «Real usage» показує РІВНО ті два способи, якими Tabs уже користуються в
 * продукті (`libs/ui/src/components/ui/tabs.tsx`), а не вигадані приклади.
 */
export function PlaygroundTabsPage() {
  const { t } = useTranslation('playground');
  const [view, setView] = useState<CalendarViewSample>('week');

  return (
    <div className="mx-auto max-w-7xl">
      <PageBreadcrumbs
        items={[
          { label: t('title'), to: '/playground' },
          { label: t('nav.components') },
          { label: t('nav.tabs') },
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
          {t('tabs.title')}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">{t('tabs.description')}</p>
      </header>

      <div className="min-w-0 space-y-6">
        <section id="tabs-overview" className="scroll-mt-6">
          <div className="rounded-xl bg-muted/50 p-4">
            <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('tabs.importLabel')}
            </p>
            <code className="block overflow-x-auto font-mono text-xs leading-6 text-foreground">
              import {'{ Tabs, TabsList, TabsTrigger, TabsContent }'} from
              '@saas-skeleton/ui/components/ui/tabs';
            </code>
          </div>
        </section>

        <ShowcaseCard
          id="tabs-variants"
          title={t('tabs.sections.variants.title')}
          description={t('tabs.sections.variants.description')}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <ExampleTile
              code='variant="default"'
              description={t('tabs.variants.default.description')}
            >
              <Tabs defaultValue="overview" className="w-56">
                <TabsList variant="default">
                  <TabsTrigger value="overview">{t('tabs.labels.overview')}</TabsTrigger>
                  <TabsTrigger value="contacts">{t('tabs.labels.contacts')}</TabsTrigger>
                </TabsList>
              </Tabs>
            </ExampleTile>
            <ExampleTile code='variant="line"' description={t('tabs.variants.line.description')}>
              <Tabs defaultValue="overview" className="w-56">
                <TabsList variant="line">
                  <TabsTrigger value="overview">{t('tabs.labels.overview')}</TabsTrigger>
                  <TabsTrigger value="contacts">{t('tabs.labels.contacts')}</TabsTrigger>
                </TabsList>
              </Tabs>
            </ExampleTile>
          </div>
        </ShowcaseCard>

        <ShowcaseCard
          id="tabs-sizes"
          title={t('tabs.sections.sizes.title')}
          description={t('tabs.sections.sizes.description')}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <ExampleTile code='size="default"'>
              <div className="flex flex-col items-center gap-3">
                <Tabs defaultValue="overview" className="w-56">
                  <TabsList size="default">
                    <TabsTrigger value="overview">{t('tabs.labels.overview')}</TabsTrigger>
                    <TabsTrigger value="contacts">{t('tabs.labels.contacts')}</TabsTrigger>
                  </TabsList>
                </Tabs>
                <span className="text-center text-xs text-muted-foreground">
                  {t('tabs.sizes.default')}
                </span>
              </div>
            </ExampleTile>
            <ExampleTile code='size="sm"'>
              <div className="flex flex-col items-center gap-3">
                <Tabs defaultValue="overview" className="w-56">
                  <TabsList size="sm">
                    <TabsTrigger value="overview">{t('tabs.labels.overview')}</TabsTrigger>
                    <TabsTrigger value="contacts">{t('tabs.labels.contacts')}</TabsTrigger>
                  </TabsList>
                </Tabs>
                <span className="text-center text-xs text-muted-foreground">
                  {t('tabs.sizes.sm')}
                </span>
              </div>
            </ExampleTile>
          </div>
        </ShowcaseCard>

        <ShowcaseCard
          id="tabs-usage"
          title={t('tabs.sections.usage.title')}
          description={t('tabs.sections.usage.description')}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('tabs.usage.content.title')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('tabs.usage.content.description')}
                </p>
              </div>
              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">{t('tabs.labels.overview')}</TabsTrigger>
                  <TabsTrigger value="contacts">{t('tabs.labels.contacts')}</TabsTrigger>
                </TabsList>
                <TabsContent
                  value="overview"
                  className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground"
                >
                  {t('tabs.labels.overview')}
                </TabsContent>
                <TabsContent
                  value="contacts"
                  className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground"
                >
                  {t('tabs.labels.contacts')}
                </TabsContent>
              </Tabs>
              <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
                defaultValue + TabsContent
              </code>
            </div>

            <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('tabs.usage.switcher.title')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('tabs.usage.switcher.description')}
                </p>
              </div>
              <Tabs
                value={view}
                onValueChange={(next) => {
                  setView(next as CalendarViewSample);
                }}
              >
                <TabsList size="sm">
                  {CALENDAR_VIEWS.map((item) => (
                    <TabsTrigger key={item} value={item}>
                      {t(`tabs.labels.${item}`)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <ValueReadout label="value" value={view} />
              <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
                value + onValueChange, no TabsContent
              </code>
            </div>
          </div>
        </ShowcaseCard>

        <ShowcaseCard
          id="tabs-api"
          title={t('tabs.sections.api.title')}
          description={t('tabs.sections.api.description')}
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
                  <code>variant</code>
                </TableCell>
                <TableCell>
                  <code>default | line</code>
                </TableCell>
                <TableCell>
                  <code>default</code>
                </TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">
                  {t('tabs.api.rows.variant')}
                </TableCell>
              </TableRow>
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
                  {t('tabs.api.rows.size')}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code>orientation</code>
                </TableCell>
                <TableCell>
                  <code>horizontal | vertical</code>
                </TableCell>
                <TableCell>
                  <code>horizontal</code>
                </TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">
                  {t('tabs.api.rows.orientation')}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </ShowcaseCard>
      </div>
    </div>
  );
}
