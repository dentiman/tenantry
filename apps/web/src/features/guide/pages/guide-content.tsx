import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@saas-skeleton/ui/components/ui/card';
import { Separator } from '@saas-skeleton/ui/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import { cn } from '@saas-skeleton/ui/lib/utils';
import { useGuideSectionStore } from '../stores/guide-section.store';
import {
  DELIVERY_MODULES,
  GUIDE_SECTIONS,
  guideSectionFromHash,
  MODULE_GROUPS,
  MODULE_STATUSES,
  SUBSYSTEMS,
  type GuideSectionId,
  type ModuleStatus,
  type ProductModule,
  type SubsystemId,
} from './guide.content';

const ALL = 'all';

/**
 * Абзаци й пункти списків лежать у словнику масивами (`returnObjects: true`):
 * перекладач бачить блок цілим, а не `item1…itemN`. Типізація i18next віддає
 * для таких ключів `$SpecialObject`, тож масив рядків перевіряється тут —
 * зламаний переклад дасть порожній список, а не падіння сторінки.
 */
function asList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

const STATUS_BADGE_VARIANT = {
  done: 'success',
  partial: 'warning',
  designed: 'secondary',
  planned: 'outline',
} as const satisfies Record<ModuleStatus, string>;

const DIAGRAM_SRC = '/diagrams/architecture.html';

/**
 * Усе, що Archify малює навколо схеми: тулбар (тема/стиль/експорт), заголовок,
 * «guided views», панель PATH/MAP/LENS із зумом, спливні панелі (паспорт вузла,
 * route probe, lens, radar) і картки під схемою. Картки перенесено на саму
 * сторінку («Ключові підсистеми»), решта — перемикачі, які у вбудованій схемі
 * лише заважають. Лишається SVG і рантайм Archify, тож підсвітка вузлів і
 * зв'язків при наведенні працює як в оригіналі.
 *
 * Фон теж знято: і сторінка схеми, і її власна сітка (`<rect fill="url(#grid)">`
 * першим шаром SVG) — схема лежить прямо на фоні путівника. Кольори вузлів і
 * ліній Archify перемикає сам від `data-theme`, який ставить `ArchitectureDiagram`.
 *
 * `color-scheme` від того ж `data-theme` — обовʼязковий, а не косметика: коли
 * схема документа в iframe (без неї — світла) не збігається зі схемою сторінки,
 * браузер малює під iframe НЕПРОЗОРУ підкладку, і `background: transparent`
 * її не прибирає. У темній темі схема стояла на білому прямокутнику.
 *
 * Селектори — внутрішня розмітка Archify 2.x. Після перегенерації схеми
 * перевірити, що вони досі збігаються (інакше панелі просто повернуться).
 */
const ARCHIFY_EMBED_CSS = `
.toolbar, .header, #guided-views, .cards, .diagram-nav, #diagram-guide, #node-finder,
#focus-chip, #route-probe, #semantic-lens, #overview-map, #overview-map-feedback,
#share-chapter-cue, #intent-trace-status, .archify-toast { display: none !important; }
html, body { margin: 0 !important; padding: 0 !important; height: 100%; overflow: hidden !important;
  background: transparent !important; }
.container { width: 100% !important; max-width: none !important; height: 100%;
  margin: 0 !important; padding: 0 !important; }
.diagram-container { height: 100% !important; margin: 0 !important; padding: 0 !important;
  border: 0 !important; border-radius: 0 !important; box-shadow: none !important;
  background: transparent !important; }
.diagram-container > svg { width: 100% !important; height: 100% !important; max-width: none !important; }
.diagram-container > svg > rect[fill="url(#grid)"] { display: none !important; }
:root[data-theme='dark'] { color-scheme: dark; }
:root[data-theme='light'] { color-scheme: light; }
`;

/**
 * Відступ від верху області прокрутки, на якому параграф вважається «поточним»:
 * заголовок секції вже доїхав до верху, але ще не сховався. Трохи більше за
 * `scroll-mt-6` секції, щоб після кліку в сайдбарі підсвітився саме той пункт.
 */
const ACTIVE_SECTION_OFFSET = 96;

/**
 * Тіло путівника — опис продукту на одній довгій сторінці: огляд, модулі й
 * сервіси, розробка й деплой, схема архітектури, ключові підсистеми. Технічний
 * устрій коду тут свідомо не описується — стек і потоки показує сама схема.
 *
 * ОДИН вміст у двох рамах: `GuidePage` (`/guide`, усередині шела, зміст — друга
 * колонка) і `AboutPage` (`/about`, публічна, без шела, зміст — верхня смуга).
 * Рама дає лише обгортку й скролер; тут — секції й `useGuideScrollSpy`, який
 * працює з будь-яким прокручуваним елементом (слухає `scroll` у capture-фазі і
 * бере `event.target` за скролер), тому обидві рами користуються ним без правок.
 *
 * Параграфи — секції з `id` з `GUIDE_SECTIONS`, а не роути: зміст (в обох рамах
 * через `useGuideSectionStore`) підсвічує пункт за прокруткою і прокручує кліком.
 *
 * Схема — self-contained HTML від Archify у `public/diagrams/architecture.html`,
 * тому `<iframe>`: у неї свій `<html>`, стилі й рантайм підсвітки, і вставка в
 * документ застосунку конфліктувала б стилями. Файл лишається незмінним
 * результатом генерації — «вбудований» вигляд накладає `ArchitectureDiagram`
 * (див. там), а за посиланням «Відкрити окремо» доступна повна версія.
 *
 * Текст — namespace `guide` (`locales/en/guide.json`); структура, іконки й
 * статуси — `guide.content.ts`.
 */
export function GuideContent() {
  const { t } = useTranslation('guide');
  useGuideScrollSpy();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-20 pb-12">
      <section id="overview" className="flex scroll-mt-6 flex-col gap-8">
        <div className="flex max-w-3xl flex-col gap-4">
          <Badge variant="secondary">{t('overview.eyebrow')}</Badge>
          <h1 className="font-heading text-4xl font-semibold tracking-tight text-foreground">
            {t('overview.title')}
          </h1>
          <p className="text-lg leading-8 text-muted-foreground">{t('overview.lead')}</p>
          <div className="flex flex-wrap gap-2">
            {asList(t('overview.chips', { returnObjects: true })).map((chip) => (
              <Badge key={chip} variant="outline">
                {chip}
              </Badge>
            ))}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <ProseCard
            title={t('overview.about.title')}
            paragraphs={asList(t('overview.about.paragraphs', { returnObjects: true }))}
          />
          <ProseCard
            title={t('overview.goal.title')}
            paragraphs={asList(t('overview.goal.paragraphs', { returnObjects: true }))}
          />
        </div>
      </section>

      <ModuleMap />

      <section id="delivery" className="flex scroll-mt-6 flex-col gap-6">
        <SectionHeading section="delivery" description={t('delivery.description')} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {DELIVERY_MODULES.map((module) => (
            <ModuleCard key={module.id} module={module} />
          ))}
        </div>
      </section>

      <section id="architecture" className="flex scroll-mt-6 flex-col gap-6">
        <SectionHeading section="architecture" />
        <ArchitectureDiagram />
      </section>

      <section id="subsystems" className="flex scroll-mt-6 flex-col gap-6">
        <SectionHeading section="subsystems" description={t('subsystems.description')} />
        <div className="grid gap-4 md:grid-cols-2">
          {SUBSYSTEMS.map((subsystem) => (
            <SubsystemCard key={subsystem.id} id={subsystem.id} icon={subsystem.icon} />
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Scroll-spy для змісту в сайдбарі. Сторінку скролить не вікно, а `ScrollArea`
 * шела, тому слухач — `scroll` у фазі захоплення на `document` (ця подія не
 * спливає), з відсівом «чужих» прокруток: скролер мусить містити самі секції, а
 * не бути, скажімо, списком у сайдбарі чи iframe схеми.
 *
 * Поточний — останній параграф, чий верх уже перетнув `ACTIVE_SECTION_OFFSET`.
 * Виняток — дно прокрутки: короткий останній параграф до верху не доїде ніколи,
 * тож там активним стає він.
 *
 * Клік у сайдбарі одразу ставить свій пункт і блокує оновлення на час плавної
 * прокрутки — інакше підсвітка пробігла б усі проміжні параграфи. Блок знімає
 * `scrollend`; таймаут — страховка для браузерів без цієї події.
 */
function useGuideScrollSpy() {
  useEffect(() => {
    const { setActiveId, registerScrollTo } = useGuideSectionStore.getState();
    const firstSection = document.getElementById(GUIDE_SECTIONS[0].id);
    let lockedUntil = 0;
    let frame = 0;

    const update = (scroller: Element) => {
      if (performance.now() < lockedUntil) return;
      const lastId = GUIDE_SECTIONS[GUIDE_SECTIONS.length - 1]?.id ?? GUIDE_SECTIONS[0].id;
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
        setActiveId(lastId);
        return;
      }
      const threshold = scroller.getBoundingClientRect().top + ACTIVE_SECTION_OFFSET;
      let current: GuideSectionId = GUIDE_SECTIONS[0].id;
      for (const section of GUIDE_SECTIONS) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= threshold) current = section.id;
      }
      setActiveId(current);
    };

    const onScroll = (event: Event) => {
      const scroller = event.target;
      if (!(scroller instanceof Element) || !firstSection || !scroller.contains(firstSection))
        return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        update(scroller);
      });
    };
    const onScrollEnd = () => {
      lockedUntil = 0;
    };

    const scrollToSection = (id: GuideSectionId) => {
      const element = document.getElementById(id);
      if (!element) return;
      setActiveId(id);
      lockedUntil = performance.now() + 1000;
      // Плавно — щоб було видно, куди поїхала сторінка; без анімації для тих, хто
      // її вимкнув у системі
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    };

    setActiveId(GUIDE_SECTIONS[0].id);
    registerScrollTo(scrollToSection);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('scrollend', onScrollEnd, { capture: true });

    // Вхід за посиланням `/guide#architecture` або `/about#architecture`: URL при прокрутці
    // не змінюється, тож хеш має сенс лише на вході. Таймер, а не синхронно: шел при зміні
    // `pathname` скидає прокрутку нагору ефектом, який виконується ПІСЛЯ ефектів дітей, —
    // синхронний скрол сюди відкотився б на початок. Таймер спрацьовує вже після того, як
    // React відпрацює ВСІ ефекти цього коміту. Не `requestAnimationFrame`: у фоновій вкладці
    // (посилання відкрили в новій) кадри стоять, і активний пункт змісту лишився б на «Overview»
    const initialSection = guideSectionFromHash(window.location.hash);
    const initialTimer = initialSection
      ? window.setTimeout(() => {
          scrollToSection(initialSection);
        }, 0)
      : undefined;

    return () => {
      window.clearTimeout(initialTimer);
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('scrollend', onScrollEnd, { capture: true });
      registerScrollTo(() => undefined);
    };
  }, []);
}

/**
 * Карта модулів із фільтром за статусом. Текстового пошуку свідомо немає: він
 * шукав би по рядках поточної мови, а назви модулів і так видно з одного екрана —
 * фільтр за статусом покриває питання «що вже є / що на черзі».
 */
function ModuleMap() {
  const { t } = useTranslation('guide');
  const [status, setStatus] = useState<ModuleStatus | typeof ALL>(ALL);

  const groups = MODULE_GROUPS.map((group) => ({
    ...group,
    modules: group.modules.filter((module) => status === ALL || module.status === status),
  })).filter((group) => group.modules.length > 0);

  return (
    <section id="modules" className="flex scroll-mt-6 flex-col gap-8">
      <SectionHeading section="modules" description={t('modules.description')}>
        {/* Той самий компактний сегментований перемикач, що в календарі й на
            картці кастомера (`TabsList size="sm"`), а не окремий ToggleGroup:
            один вигляд для «вибери один із кількох» на всіх сторінках */}
        <Tabs
          value={status}
          onValueChange={(next: ModuleStatus | typeof ALL) => {
            setStatus(next);
          }}
        >
          <TabsList size="sm" aria-label={t('modules.filter.label')}>
            <TabsTrigger value={ALL}>{t('modules.filter.all')}</TabsTrigger>
            {MODULE_STATUSES.map((item) => (
              <TabsTrigger key={item} value={item} title={t(`modules.statusHint.${item}`)}>
                {t(`modules.status.${item}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </SectionHeading>

      <div className="flex flex-col gap-12">
        {groups.map((group) => {
          const GroupIcon = group.icon;
          return (
            <div key={group.id} className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <GroupIcon className="size-5" />
                </div>
                <div className="flex min-w-0 flex-col">
                  <h3 className="font-heading text-lg font-semibold text-foreground">
                    {t(`modules.groups.${group.id}.title`)}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t(`modules.groups.${group.id}.description`)}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.modules.map((module) => (
                  <ModuleCard key={module.id} module={module} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ModuleCard({ module }: { module: ProductModule }) {
  const { t } = useTranslation('guide');
  const Icon = module.icon;
  // Незроблене не повинно візуально конкурувати з готовим: та сама картка,
  // але приглушена іконка, пунктирний контур і вдвічі прозоріша поверхня.
  // Зовсім без фону не можна — на брендовому фоні лишалась сама обводка
  const isBuilt = module.status === 'done' || module.status === 'partial';

  return (
    <Card
      className={cn('h-full', !isBuilt && 'bg-card/50 shadow-none ring-1 ring-border ring-dashed')}
    >
      <CardHeader>
        <div
          className={cn(
            'mb-2 flex size-10 items-center justify-center rounded-lg',
            isBuilt ? 'bg-muted text-icon-strong' : 'bg-muted/50 text-icon-muted',
          )}
        >
          <Icon className="size-5" />
        </div>
        <CardAction>
          <Badge
            variant={STATUS_BADGE_VARIANT[module.status]}
            title={t(`modules.statusHint.${module.status}`)}
          >
            {t(`modules.status.${module.status}`)}
          </Badge>
        </CardAction>
        <CardTitle>{t(`modules.items.${module.id}.title`)}</CardTitle>
        <CardDescription className="leading-6">
          {t(`modules.items.${module.id}.description`)}
        </CardDescription>
      </CardHeader>
      {module.audience && (
        <CardContent className="mt-auto">
          <Badge variant="outline">{t(`modules.audience.${module.audience}`)}</Badge>
        </CardContent>
      )}
    </Card>
  );
}

function ProseCard({ title, paragraphs }: { title: string; paragraphs: readonly string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-base leading-7 text-muted-foreground">
        {paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </CardContent>
    </Card>
  );
}

/** Заголовок параграфа: назва — `sections.<id>`, той самий ключ, що в сайдбарі. */
function SectionHeading({
  section,
  description,
  children,
}: {
  section: GuideSectionId;
  description?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation('guide');
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex max-w-3xl flex-col gap-2">
        <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          {t(`sections.${section}`)}
        </h2>
        {description && <p className="text-base leading-7 text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * Схема Archify без її оточення. Iframe того самого походження, тож після `load`
 * сторінка дописує в його документ стиль, що ховає панелі (`ARCHIFY_EMBED_CSS`),
 * і виставляє `data-theme` — Archify перефарбовує SVG за цим атрибутом, тож
 * схема йде за темою застосунку, а не за власним перемикачем.
 *
 * До ін'єкції iframe прозорий: інакше на мить блимнули б тулбар і картки.
 * Висота — від пропорцій SVG (viewBox 1352×496), щоб схема заповнювала картку
 * без порожніх смуг. Пропорції тримає внутрішній блок, а не сама картка: поле
 * `p-6` навколо — щоб крайні вузли не прилипали до контуру.
 */
function ArchitectureDiagram() {
  const { t } = useTranslation('guide');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [isReady, setIsReady] = useState(false);
  const { resolvedTheme } = useTheme();
  const archifyTheme = resolvedTheme === 'dark' ? 'dark' : 'light';

  useEffect(() => {
    const root = frameRef.current?.contentDocument?.documentElement;
    if (isReady && root) root.dataset.theme = archifyTheme;
  }, [isReady, archifyTheme]);

  return (
    // Картка напівпрозора, як «заплановані» модулі: схема майже на брендовому
    // фоні, а легка заливка й блюр гасять точки візерунка під її лініями
    <Card className="bg-card/50 p-6">
      <div className="aspect-[1352/496] min-h-60">
        <iframe
          ref={frameRef}
          src={DIAGRAM_SRC}
          title={t('architecture.frameTitle')}
          onLoad={() => {
            const doc = frameRef.current?.contentDocument;
            if (!doc) return;
            const style = doc.createElement('style');
            style.textContent = ARCHIFY_EMBED_CSS;
            doc.head.appendChild(style);
            doc.documentElement.dataset.theme = archifyTheme;
            setIsReady(true);
          }}
          className={cn(
            'h-full w-full border-0 transition-opacity',
            isReady ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>
    </Card>
  );
}

function SubsystemCard({
  id,
  icon: Icon,
}: {
  id: SubsystemId;
  icon: (typeof SUBSYSTEMS)[number]['icon'];
}) {
  const { t } = useTranslation('guide');

  return (
    <Card className="h-full">
      <CardHeader className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
        <CardTitle className="text-lg font-semibold">{t(`subsystems.items.${id}.title`)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('subsystems.businessLabel')}
          </p>
          <ul className="flex flex-col gap-1.5">
            {asList(t(`subsystems.items.${id}.business`, { returnObjects: true })).map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-6 text-foreground">
                <Check className="mt-1 size-4 shrink-0 text-success" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <Separator />
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('subsystems.technicalLabel')}
          </p>
          <ul className="flex flex-col gap-1.5">
            {asList(t(`subsystems.items.${id}.technical`, { returnObjects: true })).map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-6 text-muted-foreground">
                <span aria-hidden className="mt-2.5 size-1 shrink-0 rounded-full bg-icon-muted" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
