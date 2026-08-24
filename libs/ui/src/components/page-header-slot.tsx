import { createContext, use, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Слот у хедері layout-а, який наповнює СТОРІНКА (хлібні крихти, кнопки дії тощо).
 *
 * ── Навіщо портал ─────────────────────────────────────────────────────────────
 * Крихти належать сторінці (тільки вона знає, де вона в ієрархії), а місце для них
 * — у хедері, тобто в компоненті-предку. Підняти дані нагору можна трьома шляхами:
 *
 *   1. **Стан у layout-і** (сторінка кладе крихти в контекст/стор, хедер їх читає).
 *      Мінус: layout мусить знати тип «крихт», а сторінка — узгоджуватись із цим
 *      типом; будь-яка нова начинка хедера = зміна контракту.
 *   2. **Роутер-метадані** (крихти зі `staticData` збігів роуту). Мінус: крихти
 *      статичні, а нам треба «Users / Ада Лавлейс» — імʼя приходить із запиту.
 *   3. **Портал** — сторінка рендерить ЩО ЗАВГОДНО, а React показує це в DOM-вузлі
 *      хедера. Контракт зводиться до «є місце», типів немає взагалі.
 *
 * Обрано портал (3). Ключова властивість, заради якої: `createPortal` міняє лише
 * **DOM-розташування**, а дерево React лишається тим самим. Тобто вміст крихт —
 * усе ще діти сторінки: бачать її контекст (i18n, TanStack Router, QueryClient),
 * а події з них спливають по React-дереву сторінки, а не хедера. Це важливо для
 * `<Link>` роутера: у хедері він працює так само, як у тілі сторінки.
 *
 * ── Як це працює ──────────────────────────────────────────────────────────────
 * `PageHeaderSlot` стоїть у хедері й через ref-колбек кладе свій DOM-вузол у стан.
 * Стан їде вниз контекстом; `PageHeaderPortal` на сторінці читає вузол і, коли він
 * зʼявився, рендерить у нього `children`. На ПЕРШОМУ рендері вузла ще немає
 * (ref-колбек викликається після коміту), тому портал повертає `null` — це нормально
 * і не мигає: хедер і сторінка комітяться в одному проході, а стан слота оновлюється
 * синхронно перед промальовкою.
 *
 * Два окремі контексти навмисно: сеттер стабільний (не спричиняє зайвих ререндерів
 * споживачів), а вузол міняється рівно один раз — при монтуванні хедера.
 */
const HeaderSlotNodeContext = createContext<HTMLElement | null>(null);
const HeaderSlotRefContext = createContext<((node: HTMLElement | null) => void) | null>(null);

export function PageHeaderSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  return (
    <HeaderSlotRefContext value={setNode}>
      <HeaderSlotNodeContext value={node}>{children}</HeaderSlotNodeContext>
    </HeaderSlotRefContext>
  );
}

/** Місце в хедері layout-а, куди сторінки телепортують свій вміст */
export function PageHeaderSlot({ className }: { className?: string }) {
  const setNode = use(HeaderSlotRefContext);
  return <div ref={setNode} className={className} />;
}

/** Викликається зі сторінки: усе, що всередині, зʼявиться в хедері */
export function PageHeaderPortal({ children }: { children: ReactNode }) {
  const node = use(HeaderSlotNodeContext);
  return node ? createPortal(children, node) : null;
}
