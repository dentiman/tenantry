import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { PanelRightIcon, XIcon } from 'lucide-react';

import { cn } from '@saas-skeleton/ui/lib/utils';
import { Button } from '@saas-skeleton/ui/components/ui/button';

/**
 * Контекстна панель шела — ТРЕТЯ колонка розкладки, дзеркальна до сайдбара.
 *
 * ── Що це і чим НЕ є ──────────────────────────────────────────────────────────
 * Це не `Sheet` і не діалог. Панель не накриває контент, а СТИСКАЄ його: сторінка
 * лишається видимою і робочою, поки поруч відкрито деталі вибраного обʼєкта
 * (подія календаря, картка юзера, деталі рядка гріда). Модель — «Context Panel»
 * Notion Calendar: вибір у центрі, розкриття праворуч.
 *
 * ── Вона стоїть НА РІВНІ сайдбара, а не всередині контенту ────────────────────
 * Панель — сусід `Sidebar` і `SidebarInset`, а не вкладена в другий. Тобто вона
 * йде від самого верху вікна до низу і **підрізає хедер справа**, рівно як лівий
 * сайдбар підрізає його зліва. Це не косметика: у Notion Calendar панель — межа
 * вікна, і хедер живе МІЖ двома колонками. Варіант «панель під хедером» був
 * зроблений першим і знятий — там вона читалась як частина сторінки, а не як
 * рівноправна колонка шела, і хедер над нею обіцяв, що керує і її вмістом теж.
 *
 * Наслідок для розкладки: власна шапка панелі — така сама `h-14` з `border-b`, як
 * шапка рейлу, шапка колонки area і хедер контенту. Чотири однакові рядки
 * складають ОДНУ неперервну лінію через усе вікно (`docs/frontend/app-shell.md`
 * §5.4), і саме тому хрестик закриття стоїть у ній справа зверху.
 *
 * Наслідок для поверхні: панель стоїть на `--sidebar`, а не на `--background`.
 * Обидві бічні колонки — шасі шела, полотном лишається тільки контент посередині;
 * у темній темі, де ці два токени різні, панель на кольорі полотна виглядала б як
 * шматок сторінки, що втік до краю вікна.
 *
 * `Sheet` лишається живим і потрібним для СВОГО класу задач: тимчасове модальне
 * вікно, яке вимагає рішення й після нього зникає (`ActivityDrawer`, панель
 * сповіщень). Різниця не в геометрії, а в тому, чи мусить людина далі бачити
 * сторінку: якщо мусить — панель, якщо ні — драйвер.
 *
 * ── Механіка: той самий портал, що і в хедері ─────────────────────────────────
 * Контракт свідомо повторює `page-header-slot.tsx` (там же — розбір, чому саме
 * портал, а не стан у layout-і чи `staticData` роуту). Шел оголошує МІСЦЕ,
 * сторінка рендерить ЩО ЗАВГОДНО, типів між ними немає. `createPortal` міняє
 * тільки DOM-розташування: вміст панелі лишається дитиною сторінки — бачить її
 * контекст (i18n, роутер, QueryClient) і, головне, її СТАН, тому «вибраний
 * обʼєкт» не треба піднімати в шел.
 *
 * ── Дві незалежні речі: вміст і видимість ─────────────────────────────────────
 * `hasContent` — чи змонтований хоч один `ContextPanelPortal` (тобто чи є що
 * показувати). Належить СТОРІНЦІ.
 * `isOpen` — чи розгорнув її користувач. Належить ЛЮДИНІ, керується
 * `ContextPanelTrigger` у хедері.
 *
 * Панель видно, коли `hasContent && isOpen`; кнопки в хедері немає взагалі, доки
 * немає вмісту — мертвий контрол гірший за відсутній (те саме правило прибрало
 * «Today» зі стрілками в агенді календаря).
 *
 * Пастка, яку закриває `contentKey`: людина згорнула панель, а тоді клікнула
 * ІНШУ подію. Вміст змінився, портал лишився змонтованим — і клік виглядав би
 * як «нічого не сталося». Тому зміна `contentKey` знову розкриває панель:
 * показати новий вибір важливіше, ніж памʼятати згортання попереднього.
 *
 * ── Чому слот не розмонтовується, а ховається класом ──────────────────────────
 * Якби закрита панель не рендерила DOM-вузол, портал повертав би `null`, і вміст
 * сторінки РОЗМОНТУВАВСЯ Б: наполовину заповнена форма події зникала б від
 * натискання «сховати». Тому вузол живе завжди, а ховається `hidden` на
 * контейнері.
 */
const ContextPanelNodeContext = createContext<HTMLElement | null>(null);
const ContextPanelRefContext = createContext<((node: HTMLElement | null) => void) | null>(null);

interface ContextPanelState {
  /** Чи є що показувати — тобто чи змонтований портал зі сторінки */
  hasContent: boolean;
  /** Чи розгорнута панель користувачем */
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  /** Реєстрація вмісту; повертає функцію зняття з обліку */
  register: (label: string) => () => void;
}

const ContextPanelStateContext = createContext<ContextPanelState | null>(null);

export function useContextPanel(): ContextPanelState {
  const state = use(ContextPanelStateContext);
  if (!state) {
    throw new Error('useContextPanel має викликатись усередині ContextPanelProvider');
  }
  return state;
}

export function ContextPanelProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [isOpen, setOpen] = useState(true);
  // Масив, а не лічильник: імена потрібні у dev-попередженні про другий портал
  const [entries, setEntries] = useState<string[]>([]);

  const register = useCallback((label: string) => {
    setEntries((previous) => [...previous, label]);
    return () => {
      setEntries((previous) => {
        const index = previous.indexOf(label);
        if (index === -1) {
          return previous;
        }
        const next = previous.slice();
        next.splice(index, 1);
        return next;
      });
    };
  }, []);

  // Слот один, тому два портали промалюються ПОРУЧ у ньому — це не помилка
  // React, а рівно те, про що його попросили. Симптом видно тільки очима
  useEffect(() => {
    if (entries.length > 1) {
      console.error(
        `[ContextPanel] У контекстну панель одночасно рендерять ${String(entries.length)} портали ` +
          `(${entries.join(', ')}). Вони промалюються ПОРУЧ в одному вузлі. ` +
          'На екран має бути рівно один ContextPanelPortal.',
      );
    }
  }, [entries]);

  const state = useMemo<ContextPanelState>(
    () => ({ hasContent: entries.length > 0, isOpen, setOpen, register }),
    [entries.length, isOpen, register],
  );

  return (
    <ContextPanelStateContext value={state}>
      <ContextPanelRefContext value={setNode}>
        <ContextPanelNodeContext value={node}>{children}</ContextPanelNodeContext>
      </ContextPanelRefContext>
    </ContextPanelStateContext>
  );
}

/**
 * Місце для панелі в розкладці шела: остання колонка вікна.
 *
 * Ставиться СУСІДОМ `SidebarInset`, усередині `SidebarProvider` — тоді вона йде
 * на всю висоту, а хедер контенту закінчується на її межі.
 *
 * Ширина — `--context-panel-width`, дефолт **18rem/288px**. Це крок шкали (72 × 4px,
 * тобто `w-72`) і водночас константа самого реєстру: `SIDEBAR_WIDTH_MOBILE` у
 * `ui/sidebar.tsx` — рівно 18rem. У майбутньому ширина стане тягучою (resizable),
 * і саме тому вона вже сьогодні одна CSS-змінна, а не константа в класі.
 *
 * `sticky top-0 h-svh`, а не `fixed`: сторінка поруч скролиться вікном, і панель
 * мусить лишатись на місці, не виходячи з потоку — інакше вона не віднімала б
 * ширину, а накривала контент (той самий ідіом, що в `ActivityPanel`).
 *
 * На вузькому екрані стискати нічого: там панель лягає ПОВЕРХ (`fixed`), бо
 * інакше від контенту не лишилося б місця. Це єдиний випадок, коли вона
 * поводиться як драйвер, і зроблено це геометрією, а не другим компонентом.
 */
export function ContextPanelSlot({ className }: { className?: string }) {
  const setNode = use(ContextPanelRefContext);
  const { hasContent, isOpen } = useContextPanel();
  const isVisible = hasContent && isOpen;

  return (
    <aside
      data-slot="context-panel"
      data-state={isVisible ? 'open' : 'closed'}
      className={cn(
        'flex shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar text-sidebar-foreground',
        // Вузький екран: накладка на всю висоту
        'fixed inset-y-0 right-0 z-30 w-[min(18rem,100vw)] shadow-lg',
        // Від `md` — повновисотна колонка вікна, дзеркальна до сайдбара
        'md:sticky md:inset-y-auto md:top-0 md:right-auto md:z-auto md:h-svh md:w-[var(--context-panel-width,18rem)] md:shadow-none',
        // Не розмонтування, а приховування: інакше вміст порталу зник би разом
        // із вузлом, а з ним і стан заповненої форми
        !isVisible && 'hidden',
        className,
      )}
    >
      <div ref={setNode} className="flex min-h-0 flex-1 flex-col" />
    </aside>
  );
}

/**
 * Викликається зі сторінки: усе, що всередині, зʼявиться в контекстній панелі.
 *
 * `contentKey` — ідентичність показаного обʼєкта (id події, id юзера). Її зміна
 * знову розкриває згорнуту панель; без неї клік по іншому обʼєкту при згорнутій
 * панелі виглядав би як «нічого не сталося».
 *
 * `label` іде тільки в попередження про другий портал.
 */
export function ContextPanelPortal({
  children,
  contentKey,
  label,
}: {
  children: ReactNode;
  contentKey?: string;
  label?: string;
}) {
  const node = use(ContextPanelNodeContext);
  const { register, setOpen } = useContextPanel();
  const name = label ?? 'ContextPanelPortal';

  useEffect(() => register(name), [register, name]);

  // Монтування вмісту і зміна показаного обʼєкта розкривають панель
  useEffect(() => {
    setOpen(true);
  }, [setOpen, contentKey]);

  return node ? createPortal(children, node) : null;
}

/**
 * Кнопка показу/приховування панелі — у правому куті хедера шела, рівно над
 * самою панеллю. Доки сторінка нічого не поклала в панель, кнопки немає.
 */
export function ContextPanelTrigger({ className }: { className?: string }) {
  const { t } = useTranslation('common');
  const { hasContent, isOpen, setOpen } = useContextPanel();

  if (!hasContent) {
    return null;
  }

  return (
    <Button
      data-slot="context-panel-trigger"
      variant="ghost"
      size="icon-sm"
      aria-pressed={isOpen}
      aria-label={t(isOpen ? 'contextPanel.hide' : 'contextPanel.show')}
      className={className}
      onClick={() => {
        setOpen(!isOpen);
      }}
    >
      <PanelRightIcon />
    </Button>
  );
}

/**
 * Стандартна шапка вмісту панелі: назва, пояснення і хрестик справа зверху.
 *
 * Метрика — `h-14` з `border-b`, тобто РІВНО та сама, що в шапки рейлу, шапки
 * колонки area і хедера контенту: чотири рядки складають одну неперервну лінію
 * через усе вікно. Тому тут два яруси в межах одного рядка (назва + пояснення
 * `text-xs`), а не вільна висота, і тому `text-sm`, а не `text-base`.
 *
 * Бокові поля — `px-2` (8px), удвічі тісніші за поля сторінки: це метрика ВСІЄЇ
 * панелі (див. §5.6 `docs/frontend/app-shell.md`), і шапка тримає її разом із
 * вмістом, інакше назва висіла б із іншим відступом, ніж поля форми під нею.
 *
 * Хрестик закриває САМ ВМІСТ (`onClose` сторінки знімає вибір), а не ховає
 * панель: сховати її — це кнопка в хедері. Дві дії різні, і плутати їх не можна
 * — після «сховати» вибір лишається, після хрестика зникає.
 */
export function ContextPanelHeader({
  title,
  description,
  actions,
  onClose,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation('common');

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-medium text-foreground">{title}</h2>
        {description ? (
          <p className="truncate text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions}
      <Button variant="ghost" size="icon-sm" aria-label={t('actions.close')} onClick={onClose}>
        <XIcon />
      </Button>
    </div>
  );
}
