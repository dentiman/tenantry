import { Link } from '@tanstack/react-router';
import { ArrowRight, Mail, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button, buttonVariants } from '@saas-skeleton/ui/components/ui/button';
import { Spinner } from '@saas-skeleton/ui/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@saas-skeleton/ui/components/ui/table';
import { ExampleTile, ShowcaseCard } from '../components/showcase';

export function PlaygroundPage() {
  const { t } = useTranslation('playground');

  const variants = [
    {
      variant: 'default' as const,
      label: t('button.variants.default.label'),
      description: t('button.variants.default.description'),
    },
    {
      variant: 'secondary' as const,
      label: t('button.variants.secondary.label'),
      description: t('button.variants.secondary.description'),
    },
    {
      variant: 'outline' as const,
      label: t('button.variants.outline.label'),
      description: t('button.variants.outline.description'),
    },
    {
      variant: 'elevated' as const,
      label: t('button.variants.elevated.label'),
      description: t('button.variants.elevated.description'),
    },
    {
      variant: 'ghost' as const,
      label: t('button.variants.ghost.label'),
      description: t('button.variants.ghost.description'),
    },
    {
      variant: 'destructive' as const,
      label: t('button.variants.destructive.label'),
      description: t('button.variants.destructive.description'),
    },
    {
      variant: 'link' as const,
      label: t('button.variants.link.label'),
      description: t('button.variants.link.description'),
    },
  ];

  const sizes = [
    { size: 'xs' as const, label: t('button.sizes.xs') },
    { size: 'sm' as const, label: t('button.sizes.sm') },
    { size: 'default' as const, label: t('button.sizes.default') },
    { size: 'lg' as const, label: t('button.sizes.lg') },
  ];

  const iconSizes = [
    { size: 'icon-xs' as const, label: 'size="icon-xs" · 28 px' },
    { size: 'icon-sm' as const, label: 'size="icon-sm" · 32 px' },
    { size: 'icon' as const, label: 'size="icon" · 36 px' },
    { size: 'icon-lg' as const, label: 'size="icon-lg" · 40 px' },
  ];

  const navigation = [
    { href: '#button-overview', label: t('navigation.overview') },
    { href: '#button-variants', label: t('navigation.variants') },
    { href: '#button-sizes', label: t('navigation.sizes') },
    { href: '#button-radius', label: t('navigation.radius') },
    { href: '#button-icons', label: t('navigation.icons') },
    { href: '#button-states', label: t('navigation.states') },
    { href: '#button-api', label: t('navigation.api') },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageBreadcrumbs
        items={[
          { label: t('title'), to: '/playground' },
          { label: t('nav.components') },
          { label: t('nav.buttons') },
        ]}
      />

      <header className="mb-10 max-w-3xl">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{t('eyebrow')}</Badge>
          {/* Джерело походження — General Components живуть у libs/ui, тому
              завжди зі своєю позначкою: native (стоковий) чи changed (зі
              своєю локальною правкою реєстру, docs/frontend/ui-stack.md) */}
          <Badge variant="outline" title={t('origin.changed.hint')}>
            {t('origin.changed.label')}
          </Badge>
        </div>
        <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-foreground">
          {t('title')}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">{t('description')}</p>
      </header>

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="min-w-0 space-y-6">
          <section id="button-overview" className="scroll-mt-6">
            <div className="mb-5">
              <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
                {t('button.title')}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {t('button.description')}
              </p>
            </div>
            <div className="rounded-xl bg-muted/50 p-4">
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('button.importLabel')}
              </p>
              <code className="block overflow-x-auto font-mono text-xs leading-6 text-foreground">
                import {'{ Button }'} from '@saas-skeleton/ui/components/ui/button';
              </code>
            </div>
          </section>

          <ShowcaseCard
            id="button-variants"
            title={t('button.sections.variants.title')}
            description={t('button.sections.variants.description')}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {variants.map(({ variant, label, description }) => (
                <ExampleTile key={variant} code={`variant="${variant}"`} description={description}>
                  <Button variant={variant}>{label}</Button>
                </ExampleTile>
              ))}
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="button-sizes"
            title={t('button.sections.sizes.title')}
            description={t('button.sections.sizes.description')}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {sizes.map(({ size, label }) => (
                <ExampleTile key={size} code={`size="${size}"`}>
                  <div className="flex flex-col items-center gap-3">
                    <Button size={size}>{t('button.variants.default.label')}</Button>
                    <span className="text-center text-xs text-muted-foreground">{label}</span>
                  </div>
                </ExampleTile>
              ))}
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="button-radius"
            title={t('button.sections.radius.title')}
            description={t('button.sections.radius.description')}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ExampleTile
                code='radius="default"'
                description={t('button.radius.defaultDescription')}
              >
                <Button radius="default">{t('button.radius.default')}</Button>
              </ExampleTile>
              <ExampleTile code='radius="full"' description={t('button.radius.fullDescription')}>
                <Button radius="full">{t('button.radius.full')}</Button>
              </ExampleTile>
              <ExampleTile code='variant="secondary" radius="full"'>
                <Button variant="secondary" radius="full">
                  {t('button.variants.secondary.label')}
                </Button>
              </ExampleTile>
              <ExampleTile
                code='size="icon" radius="full"'
                description={t('button.radius.iconDescription')}
              >
                <Button
                  size="icon"
                  radius="full"
                  variant="secondary"
                  aria-label={t('button.icons.addLabel')}
                >
                  <Plus />
                </Button>
              </ExampleTile>
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="button-icons"
            title={t('button.sections.icons.title')}
            description={t('button.sections.icons.description')}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <ExampleTile code='data-icon="inline-start"'>
                <Button>
                  <Mail data-icon="inline-start" />
                  {t('button.icons.leading')}
                </Button>
              </ExampleTile>
              <ExampleTile code='data-icon="inline-end"'>
                <Button variant="secondary">
                  {t('button.icons.trailing')}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </ExampleTile>
              <ExampleTile code='variant="destructive"'>
                <Button variant="destructive">
                  <Trash2 data-icon="inline-start" />
                  {t('button.icons.destructive')}
                </Button>
              </ExampleTile>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {iconSizes.map(({ size, label }) => (
                <ExampleTile key={size} code={`${label} · radius="full"`}>
                  <Button
                    size={size}
                    radius="full"
                    variant="secondary"
                    aria-label={t('button.icons.addLabel')}
                  >
                    <Plus />
                  </Button>
                </ExampleTile>
              ))}
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="button-states"
            title={t('button.sections.states.title')}
            description={t('button.sections.states.description')}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <ExampleTile code="disabled">
                <Button disabled>{t('button.states.disabled')}</Button>
              </ExampleTile>
              <ExampleTile code="disabled + Spinner">
                <Button disabled>
                  <Spinner data-icon="inline-start" />
                  {t('button.states.loading')}
                </Button>
              </ExampleTile>
              <ExampleTile
                code="buttonVariants({ variant: 'secondary' })"
                description={t('button.states.buttonLink')}
              >
                <Link to="/workspace/users" className={buttonVariants({ variant: 'secondary' })}>
                  {t('button.states.openUsers')}
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </ExampleTile>
            </div>

            <div className="mt-3 rounded-xl bg-muted/50 p-4">
              <code className="mb-4 block font-mono text-xs text-foreground">
                className=&quot;w-full&quot;
              </code>
              <Button className="w-full">{t('button.states.fullWidth')}</Button>
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="button-api"
            title={t('button.sections.api.title')}
            description={t('button.sections.api.description')}
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
                    <code>default | outline | secondary | ghost | destructive | link</code>
                  </TableCell>
                  <TableCell>
                    <code>default</code>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('button.api.rows.variant')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>size</code>
                  </TableCell>
                  <TableCell>
                    <code>default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg</code>
                  </TableCell>
                  <TableCell>
                    <code>default</code>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('button.api.rows.size')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>radius</code>
                  </TableCell>
                  <TableCell>
                    <code>default | full</code>
                  </TableCell>
                  <TableCell>
                    <code>default</code>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('button.api.rows.radius')}
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
                    {t('button.api.rows.disabled')}
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
                    {t('button.api.rows.className')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>render</code>
                  </TableCell>
                  <TableCell>
                    <code>ReactElement | function</code>
                  </TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('button.api.rows.render')}
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
            {navigation.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>
      </div>
    </div>
  );
}
