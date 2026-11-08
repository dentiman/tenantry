import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandBackdrop } from '@saas-skeleton/ui/components/brand-backdrop';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@saas-skeleton/ui/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@saas-skeleton/ui/components/ui/tabs';
import './playground-cards.css';

const SCENES = ['solid', 'brand', 'violet', 'emerald', 'amber'] as const;
type SceneId = (typeof SCENES)[number];

const FILLS = ['default', 'muted', 'subtle', 'ghost', 'opaque', 'nested'] as const;
/* Для матриці — лише видимі ступені: `ghost` зводить тон нанівець разом із
   заливкою, `opaque` існує як виняток і тону не несе */
const MATRIX_FILLS = ['default', 'muted', 'subtle'] as const;
const TONES = ['neutral', 'info', 'success', 'warning', 'danger', 'accent'] as const;
const BORDERS = ['solid', 'dashed', 'dotted'] as const;
const RADII = ['default', 'sm', 'none'] as const;
const COMBINED = ['planned', 'warning', 'dropzone', 'positive', 'event', 'edgeNeutral'] as const;
const RELATED = ['popover', 'dialog', 'alert', 'contextPanel'] as const;

type Fill = (typeof FILLS)[number];
type Tone = (typeof TONES)[number];
type Border = (typeof BORDERS)[number];

/**
 * Каталог карткових поверхонь: три незалежні осі замість імен різновидів.
 *
 * Стенд існує заради одного твердження, яке словами не передається:
 * розмітка картки не змінюється НІКОЛИ. Перемикач фону вгорі міняє лише
 * значення токенів, а `<Card>` лишається тим самим рядком JSX. Тому фон
 * вмикається на весь контент сторінки, а не на окремі рамки — поки він жив
 * у локальних контейнерах, здавалося, що скло є властивістю контейнера.
 *
 * Чому тут НЕМАЄ `ShowcaseCard`, на відміну від решти стендів: обгортка-картка
 * навколо картки-зразка робить рівно ту помилку, яку стенд має пояснювати —
 * дві поверхні одна в одній, і межа зразка перестає читатись.
 */
export function PlaygroundCardsPage() {
  const { t } = useTranslation('playground');
  const [scene, setScene] = useState<SceneId>('solid');
  const withBackdrop = scene !== 'solid';

  return (
    <div
      // Від'ємні поля гасять `px-6 pt-4 pb-6` контейнера контенту
      // (`app-shell.tsx`), щоб фон ліг на всю область, як на `/guide`, а не
      // прямокутником усередині неї. `isolate` потрібен, бо `BrandBackdrop`
      // у варіанті `inset` позиціонується від найближчого предка.
      // Фон ЗАКРІПЛЕНИЙ (`position: fixed` у `.brand-backdrop`), як на `/guide`:
      // плями стоять на місці, а картки проїжджають над світлими й темними
      // ділянками. Через це тут НЕМАЄ `overflow-hidden` — він нічого не
      // обрізав би (fixed його не слухає), зате ламав би липкі елементи.
      className="cards-scene relative isolate -mx-6 -mt-4 -mb-6 min-h-full px-6 pt-4 pb-6"
      data-backdrop={withBackdrop ? 'brand' : undefined}
      data-tone={scene !== 'solid' && scene !== 'brand' ? scene : undefined}
    >
      {withBackdrop ? <BrandBackdrop /> : null}
      <div className="relative mx-auto max-w-7xl">
        <PageBreadcrumbs
          items={[
            { label: t('title'), to: '/playground' },
            { label: t('nav.components') },
            { label: t('nav.cards') },
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
            {t('cards.title')}
          </h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">{t('cards.description')}</p>
        </header>

        <div className="min-w-0 space-y-14">
          <section>
            <div className="rounded-xl border border-dashed border-border p-4">
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('cards.importLabel')}
              </p>
              <code className="block overflow-x-auto font-mono text-xs leading-6 text-foreground">
                {'<Card fill="muted" tone="warning" border="dashed" />'}
              </code>
            </div>
          </section>

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
              {t(`cards.scene.${scene}.hint`)}
            </p>
          </section>

          <Section
            id="cards-fill"
            title={t('cards.sections.fill.title')}
            description={t('cards.sections.fill.description')}
          >
            <Grid>
              {FILLS.map((fill) => (
                <Sample
                  key={fill}
                  caption={t(`cards.fill.${fill}.label`)}
                  code={`fill="${fill}"`}
                  note={t(`cards.fill.${fill}.description`)}
                >
                  <Card size="sm" fill={fill}>
                    <SampleBody />
                  </Card>
                </Sample>
              ))}
            </Grid>
          </Section>

          {/* Окрема секція, бо `nested` — єдина роль осі, що міряє себе проти
              БАТЬКА, а не проти полотна. Показати її в спільній сітці `fill`
              неможливо: там зразки лежать на полотні, де ніша виглядає як
              звичайна картка, і вся її суть пропадає. */}
          <Section
            id="cards-nested"
            title={t('cards.sections.nested.title')}
            description={t('cards.sections.nested.description')}
          >
            <div className="grid gap-x-6 gap-y-8 md:grid-cols-3">
              <Sample
                caption={t('cards.nested.onCard.label')}
                code={t('cards.nested.onCard.code')}
                note={t('cards.nested.onCard.description')}
              >
                <Card size="sm">
                  <CardHeader>
                    <CardTitle>{t('cards.nested.parent')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Card size="sm" fill="nested">
                      <CardContent className="text-muted-foreground">
                        {t('cards.nested.body')}
                      </CardContent>
                    </Card>
                  </CardContent>
                </Card>
              </Sample>

              <Sample
                caption={t('cards.nested.onCanvas.label')}
                code={t('cards.nested.onCanvas.code')}
                note={t('cards.nested.onCanvas.description')}
              >
                <Card size="sm" fill="nested">
                  <CardContent className="text-muted-foreground">
                    {t('cards.nested.body')}
                  </CardContent>
                </Card>
              </Sample>

              {/* Контрприклад навмисно поруч: без нього «ніша» виглядає як ще
                  один відтінок, а не як відповідь на конкретну проблему */}
              <Sample
                caption={t('cards.nested.vsMuted.label')}
                code={t('cards.nested.vsMuted.code')}
                note={t('cards.nested.vsMuted.description')}
              >
                <Card size="sm">
                  <CardHeader>
                    <CardTitle>{t('cards.nested.parent')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Card size="sm" fill="muted">
                      <CardContent className="text-muted-foreground">
                        {t('cards.nested.body')}
                      </CardContent>
                    </Card>
                  </CardContent>
                </Card>
              </Sample>
            </div>
          </Section>

          <Section
            id="cards-tone"
            title={t('cards.sections.tone.title')}
            description={t('cards.sections.tone.description')}
          >
            <Grid>
              {TONES.map((tone) => (
                <Sample
                  key={tone}
                  caption={t(`cards.tone.${tone}.label`)}
                  code={`tone="${tone}"`}
                  note={t(`cards.tone.${tone}.description`)}
                >
                  <Card size="sm" tone={tone}>
                    <SampleBody />
                  </Card>
                </Sample>
              ))}
            </Grid>
          </Section>

          <Section
            id="cards-matrix"
            title={t('cards.sections.matrix.title')}
            description={t('cards.sections.matrix.description')}
          >
            <div className="space-y-3">
              {TONES.map((tone) => (
                <div key={tone} className="grid gap-3 sm:grid-cols-3">
                  {MATRIX_FILLS.map((fill) => (
                    <Card key={fill} size="sm" tone={tone} fill={fill}>
                      <CardHeader>
                        <CardTitle className="text-sm">{`${tone} · ${fill}`}</CardTitle>
                        <CardDescription>{t('cards.sampleCard.description')}</CardDescription>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              ))}
            </div>
          </Section>

          <Section
            id="cards-border"
            title={t('cards.sections.border.title')}
            description={t('cards.sections.border.description')}
          >
            <Grid>
              {BORDERS.map((border) => (
                <Sample
                  key={border}
                  caption={t(`cards.border.${border}.label`)}
                  code={`border="${border}"`}
                  note={t(`cards.border.${border}.description`)}
                >
                  <Card size="sm" border={border}>
                    <SampleBody />
                  </Card>
                </Sample>
              ))}
            </Grid>
          </Section>

          <Section
            id="cards-radius"
            title={t('cards.sections.radius.title')}
            description={t('cards.sections.radius.description')}
          >
            <Grid>
              {RADII.map((radius) => (
                <Sample
                  key={radius}
                  caption={t(`cards.radius.${radius}.label`)}
                  code={`radius="${radius}"`}
                  note={t(`cards.radius.${radius}.description`)}
                >
                  <Card size="sm" radius={radius}>
                    <SampleBody />
                  </Card>
                </Sample>
              ))}
            </Grid>
          </Section>

          <Section
            id="cards-combined"
            title={t('cards.sections.combined.title')}
            description={t('cards.sections.combined.description')}
          >
            <Grid>
              {COMBINED.map((id) => {
                const props = COMBINED_PROPS[id];

                return (
                  <Sample
                    key={id}
                    caption={t(`cards.combined.${id}.label`)}
                    code={t(`cards.combined.${id}.code`)}
                    note={t(`cards.combined.${id}.description`)}
                  >
                    <Card size="sm" {...props}>
                      <SampleBody />
                    </Card>
                  </Sample>
                );
              })}
            </Grid>
          </Section>

          <Section
            id="cards-anatomy"
            title={t('cards.sections.anatomy.title')}
            description={t('cards.sections.anatomy.description')}
          >
            <div className="max-w-md">
              <Card>
                <CardHeader>
                  <CardTitle>{t('cards.anatomy.title')}</CardTitle>
                  <CardDescription>{t('cards.anatomy.descriptionText')}</CardDescription>
                  <CardAction>
                    <Button size="xs" variant="outline">
                      {t('cards.anatomy.action')}
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent>{t('cards.anatomy.content')}</CardContent>
                <CardFooter>
                  <span className="text-xs text-muted-foreground">{t('cards.anatomy.footer')}</span>
                </CardFooter>
              </Card>
            </div>
          </Section>

          <Section
            id="cards-sizes"
            title={t('cards.sections.sizes.title')}
            description={t('cards.sections.sizes.description')}
          >
            <div className="grid gap-x-6 gap-y-8 md:grid-cols-2">
              {(['default', 'sm'] as const).map((size) => (
                <Sample
                  key={size}
                  caption={t(`cards.sizeSample.${size}.title`)}
                  code={`size="${size}"`}
                >
                  <Card size={size}>
                    <CardHeader>
                      <CardTitle>{t(`cards.sizeSample.${size}.title`)}</CardTitle>
                      <CardDescription>{t(`cards.sizeSample.${size}.description`)}</CardDescription>
                    </CardHeader>
                    <CardContent>{t('cards.sampleCard.body')}</CardContent>
                  </Card>
                </Sample>
              ))}
            </div>
          </Section>

          {/* Єдина секція, якій картка-обгортка ДОРЕЧНА: тут немає зразків
              поверхонь, лише перелік — вкладеності поверхонь не виникає */}
          <Section
            id="cards-related"
            title={t('cards.sections.related.title')}
            description={t('cards.sections.related.description')}
          >
            <Card>
              <CardContent className="divide-y divide-border/70">
                {RELATED.map((id) => (
                  <div
                    key={id}
                    className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[14rem_1fr]"
                  >
                    <div>
                      <p className="font-medium text-foreground">
                        {t(`cards.related.${id}.label`)}
                      </p>
                      <code className="font-mono text-[11px] text-muted-foreground">
                        {t(`cards.related.${id}.code`)}
                      </code>
                    </div>
                    <p className="text-muted-foreground">{t(`cards.related.${id}.description`)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </Section>
        </div>
      </div>
    </div>
  );
}

const COMBINED_PROPS: Record<
  (typeof COMBINED)[number],
  { border?: Border; edge?: boolean; fill?: Fill; tone?: Tone }
> = {
  planned: { fill: 'muted', border: 'dashed' },
  warning: { tone: 'warning', fill: 'muted' },
  dropzone: { fill: 'ghost', border: 'dotted' },
  positive: { tone: 'success', fill: 'muted' },
  event: { tone: 'info', edge: true },
  edgeNeutral: { edge: true },
};

/** Заголовок секції прямо на полотні — замість картки-обгортки, див. шапку файла */
function Section({
  children,
  description,
  id,
  title,
}: {
  children: ReactNode;
  description: string;
  id: string;
  title: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6">
      <h2
        id={`${id}-title`}
        className="font-heading text-lg leading-snug font-medium text-foreground"
      >
        {title}
      </h2>
      <p className="mt-1 mb-5 max-w-3xl text-sm text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

function Sample({
  caption,
  children,
  code,
  note,
}: {
  caption: string;
  children: ReactNode;
  code: string;
  note?: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{caption}</p>
      {children}
      <code className="block font-mono text-[11px] break-words text-muted-foreground">{code}</code>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function SampleBody() {
  const { t } = useTranslation('playground');

  return (
    <>
      <CardHeader>
        <CardTitle>{t('cards.sampleCard.title')}</CardTitle>
        <CardDescription>{t('cards.sampleCard.description')}</CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground">{t('cards.sampleCard.body')}</CardContent>
    </>
  );
}
