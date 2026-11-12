import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDownIcon,
  CopyIcon,
  PencilIcon,
  SettingsIcon,
  TrashIcon,
  UserIcon,
} from 'lucide-react';
import { BrandBackdrop } from '@saas-skeleton/ui/components/brand-backdrop';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import { Card, CardContent } from '@saas-skeleton/ui/components/ui/card';
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@saas-skeleton/ui/components/ui/combobox';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@saas-skeleton/ui/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@saas-skeleton/ui/components/ui/dropdown-menu';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@saas-skeleton/ui/components/ui/hover-card';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@saas-skeleton/ui/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@saas-skeleton/ui/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import './playground-cards.css';

/** Сцени ті самі, що в каталозі карток (`playground-cards.css` дає їм тони фону) */
const SCENES = ['solid', 'brand', 'violet', 'emerald', 'amber'] as const;
type SceneId = (typeof SCENES)[number];

/** Значення за замовчуванням збігаються з токенами `brand-backdrop.css` §5 */
const DEFAULT_ALPHA = 60;
const DEFAULT_BLUR = 30;

const FRAMEWORKS = [
  { id: 'nest', label: 'NestJS' },
  { id: 'react', label: 'React' },
  { id: 'prisma', label: 'Prisma' },
  { id: 'zod', label: 'Zod' },
  { id: 'tanstack', label: 'TanStack Query' },
];

const OWNERS = ['any', 'me', 'team'] as const;

/**
 * Каталог попапів на різних фонах: меню, список, `Popover`, контекстне меню,
 * `HoverCard`, `Combobox`.
 *
 * Попапи рендеряться через Portal у `body`, тож «знають» про брендовий фон лише
 * через `:root:has([data-backdrop='brand'])` (`brand-backdrop.css` §5). Сцена
 * «No backdrop» не має `data-backdrop` — там попапи лишаються суцільними.
 *
 * Два ползунки наживо ставлять `--popup-glass-alpha` і `--popup-blur` на `<html>`
 * (і знімають при виході зі сторінки) — так добирають густину скла й розмиття без
 * перезбірки. Те, що тут сподобалось, переноситься в дефолти `brand-backdrop.css` §5.
 */
export function PlaygroundPopupsPage() {
  const { t } = useTranslation('playground');
  const [scene, setScene] = useState<SceneId>('brand');
  const [alpha, setAlpha] = useState(DEFAULT_ALPHA);
  const [blur, setBlur] = useState(DEFAULT_BLUR);
  const [owner, setOwner] = useState<string>('any');
  const [framework, setFramework] = useState<(typeof FRAMEWORKS)[number] | null>(null);
  const [showDone, setShowDone] = useState(true);
  const withBackdrop = scene !== 'solid';

  // Ручки лежать на `<html>`: попап у Portal, і змінна на контейнері сцени до нього не дійшла б
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--popup-glass-alpha', `${String(alpha)}%`);
    root.style.setProperty('--popup-blur', `${String(blur)}px`);
    return () => {
      root.style.removeProperty('--popup-glass-alpha');
      root.style.removeProperty('--popup-blur');
    };
  }, [alpha, blur]);

  return (
    <div
      className="cards-scene relative isolate -mx-6 -mt-4 -mb-6 min-h-full px-6 pt-4 pb-6"
      data-backdrop={withBackdrop ? 'brand' : undefined}
      data-tone={scene !== 'solid' && scene !== 'brand' ? scene : undefined}
    >
      {withBackdrop ? <BrandBackdrop /> : null}
      <div className="relative mx-auto max-w-5xl">
        <PageBreadcrumbs
          items={[
            { label: t('title'), to: '/playground' },
            { label: t('nav.components') },
            { label: t('nav.popups') },
          ]}
        />

        <header className="mb-8 max-w-3xl">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{t('eyebrow')}</Badge>
            <Badge variant="outline" title={t('origin.changed.hint')}>
              {t('origin.changed.label')}
            </Badge>
          </div>
          <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-foreground">
            {t('popups.title')}
          </h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            {t('popups.description')}
          </p>
        </header>

        <div className="min-w-0 space-y-8">
          <section className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              value={scene}
              onValueChange={(value) => {
                setScene(value as SceneId);
              }}
            >
              <TabsList>
                {SCENES.map((id) => (
                  <TabsTrigger key={id} value={id}>
                    {t(`cards.scene.${id}.label`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <p className="max-w-xl text-xs text-muted-foreground">
              {t(`popups.sceneHint.${withBackdrop ? 'glass' : 'solid'}`)}
            </p>
          </section>

          <Card size="sm">
            <CardContent className="grid gap-x-8 gap-y-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="grid gap-1.5 text-sm">
                <span className="flex items-baseline justify-between">
                  <span className="font-medium text-foreground">{t('popups.tune.alpha')}</span>
                  <code className="font-mono text-xs text-muted-foreground">
                    {`--popup-glass-alpha: ${String(alpha)}%`}
                  </code>
                </span>
                <input
                  type="range"
                  min={40}
                  max={100}
                  step={1}
                  value={alpha}
                  className="accent-primary"
                  onChange={(event) => {
                    setAlpha(Number(event.target.value));
                  }}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="flex items-baseline justify-between">
                  <span className="font-medium text-foreground">{t('popups.tune.blur')}</span>
                  <code className="font-mono text-xs text-muted-foreground">
                    {`--popup-blur: ${String(blur)}px`}
                  </code>
                </span>
                <input
                  type="range"
                  min={0}
                  max={64}
                  step={1}
                  value={blur}
                  className="accent-primary"
                  onChange={(event) => {
                    setBlur(Number(event.target.value));
                  }}
                />
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAlpha(DEFAULT_ALPHA);
                  setBlur(DEFAULT_BLUR);
                }}
              >
                {t('popups.tune.reset')}
              </Button>
            </CardContent>
          </Card>

          <section aria-labelledby="popups-triggers-title">
            <h2
              id="popups-triggers-title"
              className="font-heading text-lg leading-snug font-medium text-foreground"
            >
              {t('popups.triggers.title')}
            </h2>
            <p className="mt-1 mb-4 max-w-3xl text-sm text-muted-foreground">
              {t('popups.triggers.description')}
            </p>

            <div className="flex flex-wrap items-start gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" />}>
                  {t('popups.menu.trigger')}
                  <ChevronDownIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  {/* `GroupLabel` Base UI вимагає батька `Menu.Group` — без нього падає */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{t('popups.menu.label')}</DropdownMenuLabel>
                    <DropdownMenuItem>
                      <UserIcon />
                      {t('popups.menu.profile')}
                      <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <SettingsIcon />
                      {t('popups.menu.settings')}
                      <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuCheckboxItem
                    checked={showDone}
                    onCheckedChange={(next) => {
                      setShowDone(next);
                    }}
                  >
                    {t('popups.menu.showDone')}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>{t('popups.menu.more')}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem>{t('popups.menu.export')}</DropdownMenuItem>
                      <DropdownMenuItem>{t('popups.menu.archive')}</DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">
                    <TrashIcon />
                    {t('popups.menu.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Select
                items={OWNERS.map((value) => ({ value, label: t(`popups.select.${value}`) }))}
                value={owner}
                onValueChange={(next: string | null) => {
                  setOwner(next ?? 'any');
                }}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OWNERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`popups.select.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Combobox
                items={FRAMEWORKS}
                value={framework}
                itemToStringLabel={(option: (typeof FRAMEWORKS)[number]) => option.label}
                onValueChange={(next: (typeof FRAMEWORKS)[number] | null) => {
                  setFramework(next);
                }}
              >
                <ComboboxInput className="w-52" placeholder={t('popups.combobox.placeholder')} />
                <ComboboxContent>
                  <ComboboxList>
                    {(option: (typeof FRAMEWORKS)[number]) => (
                      <ComboboxItem key={option.id} value={option}>
                        {option.label}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>

              <Popover>
                <PopoverTrigger render={<Button variant="outline" />}>
                  {t('popups.popover.trigger')}
                </PopoverTrigger>
                <PopoverContent>
                  <PopoverHeader>
                    <PopoverTitle>{t('popups.popover.title')}</PopoverTitle>
                    <PopoverDescription>{t('popups.popover.description')}</PopoverDescription>
                  </PopoverHeader>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm">
                      {t('popups.popover.cancel')}
                    </Button>
                    <Button size="sm">{t('popups.popover.apply')}</Button>
                  </div>
                </PopoverContent>
              </Popover>

              <HoverCard>
                <HoverCardTrigger render={<Button variant="outline" />}>
                  {t('popups.hover.trigger')}
                </HoverCardTrigger>
                <HoverCardContent>
                  <p className="font-medium">{t('popups.hover.title')}</p>
                  <p className="mt-1 text-muted-foreground">{t('popups.hover.description')}</p>
                </HoverCardContent>
              </HoverCard>

              <ContextMenu>
                <ContextMenuTrigger className="flex h-9 items-center rounded-lg border border-dashed border-border px-4 text-sm text-muted-foreground">
                  {t('popups.context.trigger')}
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem>
                    <PencilIcon />
                    {t('popups.context.edit')}
                  </ContextMenuItem>
                  <ContextMenuItem>
                    <CopyIcon />
                    {t('popups.context.duplicate')}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive">
                    <TrashIcon />
                    {t('popups.context.delete')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </div>
          </section>

          {/* Текст під попапами: меню відкриваються вниз саме над ним. Якщо рядки
              проглядають крізь скло — густину піднімають, а не блюр (він розмиває,
              але не гасить контраст) */}
          <section aria-labelledby="popups-underlay-title" className="space-y-3">
            <h2
              id="popups-underlay-title"
              className="font-heading text-lg leading-snug font-medium text-foreground"
            >
              {t('popups.underlay.title')}
            </h2>
            <p className="text-sm leading-7 text-foreground">{t('popups.underlay.p1')}</p>
            <p className="text-sm leading-7 text-foreground">{t('popups.underlay.p2')}</p>
            <p className="text-sm leading-7 text-foreground">{t('popups.underlay.p3')}</p>
            <p className="text-sm leading-7 text-foreground">{t('popups.underlay.p4')}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
