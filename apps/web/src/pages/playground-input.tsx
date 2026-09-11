import { AtSign, Mail, Plus, Search, X } from 'lucide-react';
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
import { Input } from '@saas-skeleton/ui/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@saas-skeleton/ui/components/ui/input-group';
import { ExampleTile, ShowcaseCard } from '../components/playground/showcase';

/**
 * Третій каталожний стенд — Input та адорнований InputGroup на одній сторінці
 * (бандл, фаза A плану). InputGroup — це Input з адорнами (іконка/кнопка з боків),
 * а не окремий незалежний компонент; природно на одній сторінці: голий Input →
 * Input з адорнами.
 */
export function PlaygroundInputPage() {
  const { t } = useTranslation('playground');

  const [searchValue, setSearchValue] = useState('');
  const [adornedValue, setAdornedValue] = useState('');
  const [emailValue, setEmailValue] = useState('');

  return (
    <div className="mx-auto max-w-7xl">
      <PageBreadcrumbs
        items={[
          { label: t('title'), to: '/playground' },
          { label: t('nav.components') },
          { label: t('nav.input') },
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
          {t('input.title')}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">{t('input.description')}</p>
      </header>

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="min-w-0 space-y-6">
          <section id="input-overview" className="scroll-mt-6">
            <div className="mb-5">
              <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
                {t('input.title')}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {t('input.description')}
              </p>
            </div>
            <div className="rounded-xl bg-muted/50 p-4">
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('input.importLabel')}
              </p>
              <code className="block overflow-x-auto font-mono text-xs leading-6 text-foreground">
                import {'{ Input }'} from '@saas-skeleton/ui/components/ui/input';
              </code>
              <code className="mt-1 block overflow-x-auto font-mono text-xs leading-6 text-foreground">
                import{' '}
                {
                  '{ InputGroup, InputGroupInput, InputGroupAddon, InputGroupButton, InputGroupText }'
                }{' '}
                from '@saas-skeleton/ui/components/ui/input-group';
              </code>
            </div>
          </section>

          <ShowcaseCard
            id="input-variants"
            title={t('input.sections.variants.title')}
            description={t('input.sections.variants.description')}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <ExampleTile
                code='size="default"'
                description={t('input.variants.default.description')}
              >
                <div className="flex flex-col items-center gap-3">
                  <Input placeholder={t('input.placeholders.defaultSize')} />
                  <span className="text-center text-xs text-muted-foreground">
                    {t('input.variants.default.label')}
                  </span>
                </div>
              </ExampleTile>
              <ExampleTile code='size="sm"' description={t('input.variants.sm.description')}>
                <div className="flex flex-col items-center gap-3">
                  <Input size="sm" placeholder={t('input.placeholders.smSize')} />
                  <span className="text-center text-xs text-muted-foreground">
                    {t('input.variants.sm.label')}
                  </span>
                </div>
              </ExampleTile>
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="input-states"
            title={t('input.sections.states.title')}
            description={t('input.sections.states.description')}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <ExampleTile code={t('input.states.disabled.code')}>
                <Input disabled placeholder={t('input.placeholders.disabled')} />
              </ExampleTile>
              <ExampleTile code={t('input.states.withValue.code')}>
                <Input defaultValue={t('input.states.withValue.sample')} />
              </ExampleTile>
              <ExampleTile
                code={t('input.states.invalid.code')}
                description={t('input.states.invalid.description')}
              >
                <Input aria-invalid defaultValue={t('input.states.invalid.sample')} />
              </ExampleTile>
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="input-group"
            title={t('input.sections.inputGroup.title')}
            description={t('input.sections.inputGroup.description')}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <ExampleTile
                code={t('input.inputGroup.icon.code')}
                description={t('input.inputGroup.icon.description')}
              >
                <InputGroup>
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput
                    placeholder={t('input.placeholders.search')}
                    value={searchValue}
                    onChange={(e) => {
                      setSearchValue(e.target.value);
                    }}
                  />
                  {searchValue ? (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        size="icon-xs"
                        radius="full"
                        aria-label={t('input.inputGroup.icon.clear')}
                        onClick={() => {
                          setSearchValue('');
                        }}
                      >
                        <X />
                      </InputGroupButton>
                    </InputGroupAddon>
                  ) : null}
                </InputGroup>
              </ExampleTile>

              <ExampleTile
                code={t('input.inputGroup.email.code')}
                description={t('input.inputGroup.email.description')}
              >
                <InputGroup>
                  <InputGroupInput
                    type="email"
                    placeholder={t('input.placeholders.email')}
                    value={emailValue}
                    onChange={(e) => {
                      setEmailValue(e.target.value);
                    }}
                  />
                  <InputGroupAddon align="inline-end">
                    <AtSign />
                  </InputGroupAddon>
                </InputGroup>
              </ExampleTile>

              <ExampleTile
                code={t('input.inputGroup.button.code')}
                description={t('input.inputGroup.button.description')}
              >
                <InputGroup>
                  <InputGroupInput
                    placeholder={t('input.inputGroup.button.placeholder')}
                    value={adornedValue}
                    onChange={(e) => {
                      setAdornedValue(e.target.value);
                    }}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={t('input.inputGroup.button.addLabel')}
                    >
                      <Plus />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </ExampleTile>

              <ExampleTile
                code={t('input.inputGroup.text.code')}
                description={t('input.inputGroup.text.description')}
              >
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>{t('input.inputGroup.text.domain')}</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput defaultValue={t('input.inputGroup.text.sample')} />
                </InputGroup>
              </ExampleTile>
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="input-usage"
            title={t('input.sections.usage.title')}
            description={t('input.sections.usage.description')}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('input.usage.password.title')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('input.usage.password.description')}
                  </p>
                </div>
                <InputGroup>
                  <InputGroupInput
                    type="password"
                    defaultValue={t('input.usage.password.sample')}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton size="icon-xs" aria-label={t('input.usage.password.toggle')}>
                      <Mail />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
                  {t('input.usage.password.path')}
                </code>
              </div>

              <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('input.usage.datePicker.title')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('input.usage.datePicker.description')}
                  </p>
                </div>
                <InputGroup>
                  <InputGroupInput
                    placeholder={t('input.usage.datePicker.placeholder')}
                    defaultValue={t('input.usage.datePicker.sample')}
                  />
                  <InputGroupAddon align="inline-end">
                    <Mail />
                  </InputGroupAddon>
                </InputGroup>
                <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
                  {t('input.usage.datePicker.path')}
                </code>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('input.usage.combobox.title')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('input.usage.combobox.description')}
                </p>
              </div>
              <InputGroup>
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput placeholder={t('input.usage.combobox.placeholder')} />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{t('input.usage.combobox.badge')}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
                {t('input.usage.combobox.path')}
              </code>
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="input-api"
            title={t('input.sections.api.title')}
            description={t('input.sections.api.description')}
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
                    {t('input.api.rows.size')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>type</code>
                  </TableCell>
                  <TableCell>
                    <code>string</code>
                  </TableCell>
                  <TableCell>
                    <code>text</code>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('input.api.rows.type')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>placeholder</code>
                  </TableCell>
                  <TableCell>
                    <code>string</code>
                  </TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('input.api.rows.placeholder')}
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
                    {t('input.api.rows.disabled')}
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
                    {t('input.api.rows.invalid')}
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
              href="#input-overview"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('input.navigation.overview')}
            </a>
            <a
              href="#input-variants"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('input.navigation.variants')}
            </a>
            <a
              href="#input-states"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('input.navigation.states')}
            </a>
            <a
              href="#input-group"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('input.navigation.inputGroup')}
            </a>
            <a
              href="#input-usage"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('input.navigation.usage')}
            </a>
            <a
              href="#input-api"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('input.navigation.api')}
            </a>
          </nav>
        </aside>
      </div>
    </div>
  );
}
