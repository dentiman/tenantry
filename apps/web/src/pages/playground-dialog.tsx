import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageBreadcrumbs } from '@saas-skeleton/ui/components/page-breadcrumbs';
import { Badge } from '@saas-skeleton/ui/components/ui/badge';
import { Button } from '@saas-skeleton/ui/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@saas-skeleton/ui/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@saas-skeleton/ui/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@saas-skeleton/ui/components/ui/field';
import { Input } from '@saas-skeleton/ui/components/ui/input';
import { ScrollArea } from '@saas-skeleton/ui/components/ui/scroll-area';
import { Switch } from '@saas-skeleton/ui/components/ui/switch';

interface StandProps {
  children: ReactNode;
  code: string;
  description: string;
  id: string;
  title: string;
}

function Stand({ children, code, description, id, title }: StandProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6">
      <Card>
        <CardHeader className="border-b border-border/70">
          <CardTitle>
            <h2 id={`${id}-title`}>{title}</h2>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-4">
          {children}
          <code className="w-fit rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
            {code}
          </code>
        </CardContent>
      </Card>
    </section>
  );
}

/** Скільки полів кладемо в довгий діалог, щоб він гарантовано впирався в стелю */
const LONG_FIELD_COUNT = 24;

/**
 * Стенд «діалог зі скролом» — перевірка того, як оверлейна смуга
 * (`docs/frontend/ui-stack.md` § «Прокрутка») поводиться в модальному вікні.
 *
 * Чому стенд узагалі потрібен: у діалозі три обмеження накладаються одночасно —
 * стеля висоти (`max-h`), фіксовані хедер і футер, і вміст невідомої довжини.
 * Це єдине місце застосунку, де скролер народжується не з розкладки сторінки, а
 * з КОМПРОМІСУ між ними, і тому єдине, де його легко зібрати неправильно.
 *
 * Два стенди поруч навмисно: другий доводить, що обмеження працює тільки коли
 * потрібно — короткий діалог мусить лишитись по висоті вмісту, а не розтягтись
 * до стелі через `flex-1` на скролері.
 */
export function PlaygroundDialogPage() {
  const { t } = useTranslation('playground');
  const [notify, setNotify] = useState(true);

  return (
    <div className="mx-auto max-w-7xl">
      <PageBreadcrumbs items={[{ label: t('title') }]} />

      <header className="mb-10 max-w-3xl">
        <Badge variant="secondary">{t('eyebrow')}</Badge>
        <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-foreground">
          {t('dialog.title')}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">{t('dialog.description')}</p>
      </header>

      <div className="flex flex-col gap-6">
        <Stand
          id="dialog-scroll-long"
          title={t('dialog.long.title')}
          description={t('dialog.long.description')}
          code={'<DialogContent className="flex max-h-[85svh] flex-col gap-0 overflow-hidden p-0">'}
        >
          <Dialog>
            <DialogTrigger render={<Button />}>{t('dialog.long.trigger')}</DialogTrigger>
            {/* Три частини діалогу, і поділ між ними той самий, що в контекстній
                панелі: шапка і футер ПОЗА скролером, скролить тільки тіло.
                `overflow-hidden p-0` на попапі — щоб заокруглення не різало
                вміст, а поля роздавала кожна частина сама */}
            <DialogContent className="flex max-h-[85svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]">
              <DialogHeader className="border-b p-4 pr-12">
                <DialogTitle>{t('dialog.long.heading')}</DialogTitle>
              </DialogHeader>

              {/* `ScrollArea`, а не `overflow-y-auto`: у діалозі постійна смуга
                  особливо помітна — вона ріже праве поле форми, яке й так
                  затиснуте стелею висоти */}
              <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-4 p-4">
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="playground-dialog-notify">
                      {t('dialog.long.notify')}
                    </FieldLabel>
                    {/* Перемикач тут не для краси: саме його прихований нативний
                        `input` дає фантомні 11px `scrollWidth` (UI-2), і стенд
                        показує, що `axis="vertical"` їх глушить */}
                    <Switch
                      id="playground-dialog-notify"
                      checked={notify}
                      onCheckedChange={setNotify}
                    />
                  </Field>

                  {Array.from({ length: LONG_FIELD_COUNT }, (_, index) => (
                    <Field key={index}>
                      <FieldLabel htmlFor={`playground-dialog-field-${String(index)}`}>
                        {t('dialog.long.field', { number: index + 1 })}
                      </FieldLabel>
                      <Input
                        id={`playground-dialog-field-${String(index)}`}
                        placeholder={t('dialog.long.placeholder')}
                      />
                    </Field>
                  ))}
                </div>
              </ScrollArea>

              <DialogFooter>
                <DialogClose render={<Button variant="secondary" />}>
                  {t('dialog.cancel')}
                </DialogClose>
                <DialogClose render={<Button />}>{t('dialog.save')}</DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Stand>

        <Stand
          id="dialog-scroll-short"
          title={t('dialog.short.title')}
          description={t('dialog.short.description')}
          code={'<ScrollArea className="min-h-0 flex-1">'}
        >
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>
              {t('dialog.short.trigger')}
            </DialogTrigger>
            {/* Та сама розмітка, що вгорі, з тим самим `max-h`: діалог мусить
                лишитись по висоті вмісту. Якби скролер розтягував себе, стеля
                перетворилась би на фіксовану висоту, і короткий діалог висів би
                порожнім на 85% екрана */}
            <DialogContent className="flex max-h-[85svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]">
              <DialogHeader className="border-b p-4 pr-12">
                <DialogTitle>{t('dialog.short.heading')}</DialogTitle>
              </DialogHeader>
              <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-4 p-4">
                  <Field>
                    <FieldLabel htmlFor="playground-dialog-name">
                      {t('dialog.short.name')}
                    </FieldLabel>
                    <Input id="playground-dialog-name" placeholder={t('dialog.long.placeholder')} />
                    <FieldDescription>{t('dialog.short.hint')}</FieldDescription>
                  </Field>
                </div>
              </ScrollArea>
              <DialogFooter>
                <DialogClose render={<Button variant="secondary" />}>
                  {t('dialog.cancel')}
                </DialogClose>
                <DialogClose render={<Button />}>{t('dialog.save')}</DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Stand>
      </div>
    </div>
  );
}
