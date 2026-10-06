import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@saas-skeleton/ui/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@saas-skeleton/ui/components/ui/field';
import { Switch } from '@saas-skeleton/ui/components/ui/switch';
import { MessageSquareTextIcon } from 'lucide-react';
import { UserMultiList, UserMultiSelect, UserRowNote } from '../../users/components/user-multi-select';

interface StandProps {
  children: ReactNode;
  description: string;
  id: string;
  title: string;
  value: string[];
}

/**
 * Обгортка стенда. Свідомо своя, а не спільна з `playground.tsx`: там
 * `ShowcaseCard` живе локально в файлі кнопок, і витягувати його в спільний
 * модуль заради другого споживача — зарано (третій стенд і буде тим приводом).
 */
function Stand({ children, description, id, title, value }: StandProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6">
      <Card>
        <CardHeader className="border-b border-border/70">
          <CardTitle>
            <h2 id={`${id}-title`}>{title}</h2>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* 384px — ширина `Sheet` (`sm:max-w-sm`), тобто найвужче місце, де
              компонент реально живе. Стенд на всю ширину картки збрехав би:
              інлайновий варіант переносить чипи саме тут */}
          <div className="w-full max-w-sm">{children}</div>
          <pre className="w-fit rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
            value = {JSON.stringify(value)}
          </pre>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Стенд вибору кількох юзерів: обидва варіанти на живих даних тенанта.
 *
 * Дизайн-джерело — `docs/frontend/design/multi-user-select/`, рішення —
 * `docs/frontend/multi-user-select.md`.
 */
export function PlaygroundUserSelectPage() {
  const { t } = useTranslation('playground');
  const [inline, setInline] = useState<string[]>([]);
  const [stacked, setStacked] = useState<string[]>([]);
  const [reorderable, setReorderable] = useState(true);

  // Перший доданий грає організатора: рядок без хрестика і без ручки. Реальний
  // споживач передасть сюди `event.ownerId`
  const [organiserId] = stacked;
  const lockedIds = organiserId ? [organiserId] : [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageBreadcrumbs
        items={[
          { label: t('title'), to: '/playground' },
          { label: t('nav.components') },
          { label: t('nav.userSelect') },
        ]}
      />

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('eyebrow')}
          </p>
          {/* Platform Components — бізнес-компонент цього застосунку, а не
              вендорений реєстром: своя позначка походження */}
          <Badge variant="outline" title={t('origin.custom.hint')}>
            {t('origin.custom.label')}
          </Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('userSelect.title')}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('userSelect.description')}</p>
      </div>

      <Stand
        id="inline"
        title={t('userSelect.inline.title')}
        description={t('userSelect.inline.description')}
        value={inline}
      >
        <Field>
          <FieldLabel htmlFor="pg-inline">{t('userSelect.guests')}</FieldLabel>
          <UserMultiSelect id="pg-inline" value={inline} onChange={setInline} />
          <FieldDescription>{t('userSelect.inline.hint')}</FieldDescription>
        </Field>
      </Stand>

      <Stand
        id="stacked"
        title={t('userSelect.stacked.title')}
        description={t('userSelect.stacked.description')}
        value={stacked}
      >
        <Field>
          <FieldLabel>{t('userSelect.guests')}</FieldLabel>
          <UserMultiList
            value={stacked}
            onChange={setStacked}
            lockedIds={lockedIds}
            reorderable={reorderable}
            renderRowEnd={(option) =>
              option.id === lockedIds[0] ? (
                <Badge variant="secondary">{t('userSelect.organiser')}</Badge>
              ) : (
                <>
                  {/* Слот приймає що завгодно — тут показані дві речі поспіль:
                      примітка і статус. Реальний споживач рендерить крапку лише
                      тоді, коли текст справді є */}
                  <UserRowNote label={t('userSelect.comment')} icon={<MessageSquareTextIcon />}>
                    {t('userSelect.commentSample')}
                  </UserRowNote>
                  <Badge variant="warning">{t('userSelect.pending')}</Badge>
                </>
              )
            }
          />
          <FieldDescription>{t('userSelect.stacked.hint')}</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Switch
            id="pg-reorder"
            checked={reorderable}
            onCheckedChange={(next: boolean) => {
              setReorderable(next);
            }}
          />
          <FieldLabel htmlFor="pg-reorder">{t('userSelect.reorderable')}</FieldLabel>
        </Field>
      </Stand>
    </div>
  );
}
