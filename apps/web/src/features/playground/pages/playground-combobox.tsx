import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlusIcon } from 'lucide-react';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@saas-skeleton/ui/components/ui/combobox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@saas-skeleton/ui/components/ui/table';
import { ExampleTile, ShowcaseCard } from '../components/showcase';

/** Голі статичні опції стенду — без бізнес-фетчингу, як і вимагає план */
interface Framework {
  id: string;
  label: string;
}

const FRAMEWORKS: Framework[] = [
  { id: 'react', label: 'React' },
  { id: 'vue', label: 'Vue' },
  { id: 'svelte', label: 'Svelte' },
  { id: 'solid', label: 'Solid' },
  { id: 'angular', label: 'Angular' },
];

/** Статичні приклади (disabled, empty) не змінюють вибір — це стенд, а не фільтр */
function noop(): void {
  return;
}

/**
 * Каталожний стенд Combobox — базовий примітив пошуку-з-попапом.
 *
 * Показуємо ГОЛИЙ Combobox (без бізнес-фетчингу — бізнес-обгортки лишаються
 * Platform-сторінкам): одиночний вибір з інпутом-тригером, кнопка-тригер без
 * шеврона з пошуком усередині попапа, multi-select на чипах, disabled/empty.
 * «Real usage» — посилання на реальні файли-споживачі з описом патернів, не
 * їх повторення. Кожен стенд має ВЛАСНИЙ anchorRef: попап якориться до
 * конкретного поля, спільний ref між стендами вкрав би якір у сусіда.
 */
export function PlaygroundComboboxPage() {
  const { t } = useTranslation('playground');

  const [single, setSingle] = useState<Framework | null>(() => FRAMEWORKS[0] ?? null);
  const [chips, setChips] = useState<Framework[]>(() =>
    [FRAMEWORKS[0], FRAMEWORKS[2]].filter((f): f is Framework => f !== undefined),
  );
  // Один якір на стенд із кнопкою-тригером: попап чіпляється до поля, а не до кнопки
  const buttonAnchorRef = useRef<HTMLDivElement | null>(null);
  const chipsAnchorRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="mx-auto max-w-7xl">
      <PageBreadcrumbs
        items={[
          { label: t('title'), to: '/playground' },
          { label: t('nav.components') },
          { label: t('nav.combobox') },
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
          {t('combobox.title')}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">
          {t('combobox.description')}
        </p>
      </header>

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="min-w-0 space-y-6">
          <section id="combobox-overview" className="scroll-mt-6">
            <div className="rounded-xl bg-muted/50 p-4">
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('combobox.importLabel')}
              </p>
              <code className="block overflow-x-auto font-mono text-xs leading-6 text-foreground">
                import{' '}
                {
                  '{ Combobox, ComboboxInput, ComboboxTrigger, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty, ComboboxChips, ComboboxChip, ComboboxChipsInput }'
                }{' '}
                from '@saas-skeleton/ui/components/ui/combobox';
              </code>
            </div>
          </section>

          <ShowcaseCard
            id="combobox-single"
            title={t('combobox.sections.single.title')}
            description={t('combobox.sections.single.description')}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <ExampleTile
                code="ComboboxInput as trigger"
                description={t('combobox.single.inputTrigger')}
              >
                <Combobox
                  items={FRAMEWORKS}
                  value={single}
                  itemToStringLabel={(option: Framework) => option.label}
                  onValueChange={(next: Framework | null) => {
                    setSingle(next);
                  }}
                >
                  <ComboboxInput className="w-56" placeholder={t('combobox.placeholders.search')} />
                  <ComboboxContent>
                    <ComboboxList>
                      {(option: Framework) => (
                        <ComboboxItem key={option.id} value={option}>
                          {option.label}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </ExampleTile>

              <ExampleTile
                code="ComboboxTrigger + search in popup"
                description={t('combobox.single.buttonTrigger')}
              >
                <div ref={buttonAnchorRef} className="w-56">
                  <Combobox
                    items={FRAMEWORKS}
                    value={single}
                    itemToStringLabel={(option: Framework) => option.label}
                    onValueChange={(next: Framework | null) => {
                      setSingle(next);
                    }}
                  >
                    <ComboboxTrigger
                      showChevron={false}
                      className="flex w-full items-center gap-2 rounded-lg border border-input bg-field px-3 py-2 text-sm"
                    >
                      <PlusIcon className="size-4 text-icon-muted" />
                      <span className="flex-1 text-left">
                        {single ? single.label : t('combobox.placeholders.pickOne')}
                      </span>
                    </ComboboxTrigger>
                    <ComboboxContent anchor={buttonAnchorRef}>
                      <div className="border-b p-1">
                        <ComboboxInput
                          placeholder={t('combobox.placeholders.search')}
                          showTrigger={false}
                        />
                      </div>
                      <ComboboxEmpty>{t('combobox.empty')}</ComboboxEmpty>
                      <ComboboxList className="max-h-[220px]">
                        {(option: Framework) => (
                          <ComboboxItem key={option.id} value={option}>
                            {option.label}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </div>
              </ExampleTile>
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="combobox-chips"
            title={t('combobox.sections.chips.title')}
            description={t('combobox.sections.chips.description')}
          >
            <ExampleTile code="multiple + ComboboxChips" description={t('combobox.chips.hint')}>
              <div ref={chipsAnchorRef} className="w-full max-w-sm">
                <Combobox
                  multiple
                  items={FRAMEWORKS}
                  value={chips}
                  itemToStringLabel={(option: Framework) => option.label}
                  onValueChange={(next: Framework[]) => {
                    setChips(next);
                  }}
                >
                  <ComboboxChips>
                    {chips.map((chip) => (
                      <ComboboxChip key={chip.id} removeLabel={t('combobox.chips.remove')}>
                        {chip.label}
                      </ComboboxChip>
                    ))}
                    <ComboboxChipsInput placeholder={t('combobox.chips.placeholder')} />
                  </ComboboxChips>
                  <ComboboxContent anchor={chipsAnchorRef}>
                    <ComboboxEmpty>{t('combobox.empty')}</ComboboxEmpty>
                    <ComboboxList className="max-h-[220px]">
                      {(option: Framework) => (
                        <ComboboxItem key={option.id} value={option}>
                          {option.label}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </div>
            </ExampleTile>
          </ShowcaseCard>

          <ShowcaseCard
            id="combobox-states"
            title={t('combobox.sections.states.title')}
            description={t('combobox.sections.states.description')}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <ExampleTile code="disabled">
                <Combobox
                  items={FRAMEWORKS}
                  value={null}
                  itemToStringLabel={(option: Framework) => option.label}
                  onValueChange={noop}
                  disabled
                >
                  <ComboboxInput
                    className="w-56"
                    placeholder={t('combobox.states.disabled')}
                    disabled
                  />
                </Combobox>
              </ExampleTile>
              <ExampleTile code="ComboboxEmpty" description={t('combobox.states.emptyHint')}>
                <div ref={buttonAnchorRef} className="w-56">
                  <Combobox
                    items={[]}
                    value={null}
                    itemToStringLabel={(option: Framework) => option.label}
                    onValueChange={noop}
                  >
                    <ComboboxInput className="w-full" showTrigger={false} />
                    <ComboboxContent anchor={buttonAnchorRef}>
                      <ComboboxEmpty>{t('combobox.empty')}</ComboboxEmpty>
                      <ComboboxList>{[]}</ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                </div>
              </ExampleTile>
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="combobox-usage"
            title={t('combobox.sections.usage.title')}
            description={t('combobox.sections.usage.description')}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('combobox.usage.serverSearch.title')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('combobox.usage.serverSearch.description')}
                  </p>
                </div>
                <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
                  apps/web/src/components/user-select.tsx
                </code>
              </div>

              <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('combobox.usage.countrySelect.title')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('combobox.usage.countrySelect.description')}
                  </p>
                </div>
                <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
                  apps/web/src/components/form/phone/country-select.tsx
                </code>
              </div>

              <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('combobox.usage.chipsMulti.title')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('combobox.usage.chipsMulti.description')}
                  </p>
                </div>
                <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
                  apps/web/src/components/user-multi-select/user-multi-select.tsx
                </code>
              </div>

              <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t('combobox.usage.customerSelect.title')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('combobox.usage.customerSelect.description')}
                  </p>
                </div>
                <code className="w-fit rounded-md bg-background px-2 py-1 font-mono text-xs text-foreground shadow-xs">
                  apps/web/src/components/calendar/customer-select.tsx
                </code>
              </div>
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            id="combobox-api"
            title={t('combobox.sections.api.title')}
            description={t('combobox.sections.api.description')}
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
                    <code>multiple</code>
                  </TableCell>
                  <TableCell>
                    <code>boolean</code>
                  </TableCell>
                  <TableCell>
                    <code>false</code>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('combobox.api.rows.multiple')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>items</code>
                  </TableCell>
                  <TableCell>
                    <code>T[]</code>
                  </TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('combobox.api.rows.items')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>value / onValueChange</code>
                  </TableCell>
                  <TableCell>
                    <code>T | null</code>
                  </TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('combobox.api.rows.value')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>filter</code>
                  </TableCell>
                  <TableCell>
                    <code>function | null</code>
                  </TableCell>
                  <TableCell>
                    <code>contains</code>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('combobox.api.rows.filter')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>itemToStringLabel</code>
                  </TableCell>
                  <TableCell>
                    <code>(T) =&gt; string</code>
                  </TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('combobox.api.rows.itemToStringLabel')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code>anchor</code> (on Content)
                  </TableCell>
                  <TableCell>
                    <code>RefObject</code>
                  </TableCell>
                  <TableCell>—</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {t('combobox.api.rows.anchor')}
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
              href="#combobox-overview"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('combobox.navigation.overview')}
            </a>
            <a
              href="#combobox-single"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('combobox.navigation.single')}
            </a>
            <a
              href="#combobox-chips"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('combobox.navigation.chips')}
            </a>
            <a
              href="#combobox-states"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('combobox.navigation.states')}
            </a>
            <a
              href="#combobox-usage"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('combobox.navigation.usage')}
            </a>
            <a
              href="#combobox-api"
              className="block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('combobox.navigation.api')}
            </a>
          </nav>
        </aside>
      </div>
    </div>
  );
}
