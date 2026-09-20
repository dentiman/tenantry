# RTL (іврит / арабська) у tenant-порталі — дослідження

> Статус: **дослідження, рішень не зафіксовано.** Дата: 2026-09-20.
> Обʼєкт: `apps/web` + `libs/ui` (спільна ліба → `apps/platform-web` зачіпається неминуче).
> Пов'язані доки: [i18n-plan.md](i18n-plan.md) (фаза I18N-4, де RTL наразі **не згаданий**),
> [frontend/ui-stack.md](frontend/ui-stack.md), [frontend/app-shell.md](frontend/app-shell.md),
> [calendar.md](calendar.md).

## Вердикт

**Складність — середня, не висока.** Стек вибрано вдало: Base UI має власний
`DirectionProvider`, Tailwind 4 має повний набір логічних утиліт, а shadcn CLI 4.19 має
**готову міграцію `shadcn migrate rtl`**, яка механічно переписує фізичні класи в логічні.
Тобто ~85–90% з 337 напрямкових входжень конвертуються автоматично.

Дорогими лишаються рівно три зони, і всі три — наші власні, не реєстрові:
шел (fixed-позиціювання сайдбарів + ресайз мишею), календар (абсолютне позиціювання
подій + drag&drop), і bidi-гігієна даних (телефони, номери, ID усередині RTL-тексту).

Оцінка: **8–13 людино-днів** на сам RTL (без перекладу 1109 ключів і без арабської/івритської
копірайтингової вичитки). З них ~1.5 дня — механіка, решта — шел, календар, QA.

## Що вже грає на нас

| Факт | Перевірено |
| --- | --- |
| `@base-ui/react@1.7.0` експортує `direction-provider`; `useDirection()` враховують `useAnchorPositioning` (усі floating-попапи), `CompositeRoot` (roving-фокус стрілками), `ScrollAreaViewport`/`Scrollbar`, `menu`, `select`, `combobox`, `navigation-menu`, `slider`, `otp-field` | `node_modules/@base-ui/react` |
| Base UI має **логічні сторони**: `Side = 'top'\|'bottom'\|'left'\|'right'\|'inline-start'\|'inline-end'` | `internals/useAnchorPositioning.d.ts:4` |
| Наші вендорені примітиви вже містять `data-[side=inline-start]` / `data-[side=inline-end]` анімації — реєстр `base-nova` частково RTL-підготовлений із коробки | `select.tsx:97`, `dropdown-menu.tsx:42` |
| `calendar.tsx` уже має `rtl:**:[.rdp-button_next>svg]:rotate-180` — react-day-picker приходить з реєстру вже з RTL-правками | `calendar.tsx:41-42` |
| Tailwind 4.3.2 має повний логічний набір: `ms/me`, `ps/pe`, `start/end`, `border-s/e`, `rounded-s/e/ss/se/es/ee`, `text-start/end`, `float-start/end`, `scroll-ms/me` | `tailwindcss/dist/lib.js` |
| `space-x-*` у Tailwind 4 генерує `margin-inline-start/end` — RTL-безпечний **автоматично** (на відміну від v3) | там само |
| `i18next@26` має вбудований `i18n.dir(lng)`; список `rtlLngs` містить `ar` і `he` | `i18next/dist/cjs/i18next.js` |
| Локаль уже прокладена наскрізь: `users.locale`, `tenants.locale`, `UserLocaleSchema`, org-level `settings.locale` | `schema.prisma:22,65,472`, `user.schema.ts:11` |
| Data-grid практично чистий — **3 напрямкові місця** на 1541 рядок | `data-grid/*` |
| Flex/grid-порядок, `justify-start/end`, `items-start/end` дзеркаляться браузером самі при `dir="rtl"` | — |

## Готове рішення: `shadcn migrate rtl`

У `shadcn@4.19.0` є `"rtl"` прапорець у `components.json` (у нас у всіх трьох — `false`)
і команда `shadcn migrate rtl [path]`, описана як *«migrate your components to support RTL»*.
Вона приймає файл, теку або glob (`**/*.{js,ts,jsx,tsx}`), тож її можна навести не лише на
`libs/ui/src/components/ui`, а й на `apps/web/src`.

Таблиця перетворень (витягнута з бандла CLI, `chunk-7SBJAAAY.js`):

| Група | Що робить |
| --- | --- |
| Логічна заміна | `ml-`→`ms-`, `mr-`→`me-`, `pl-`→`ps-`, `pr-`→`pe-`, `left-`→`start-`, `right-`→`end-` (і негативні), `rounded-tl/tr/bl/br`→`rounded-ss/se/es/ee`, `rounded-l/r`→`rounded-s/e`, `border-l/r`→`border-s/e`, `text-left/right`→`text-start/end`, `scroll-ml/mr/pl/pr`, `float-left/right`, `clear-left/right`, `origin-*-left/right` |
| Дзеркальний варіант | `translate-x-N` → додає `rtl:-translate-x-N` (і навпаки) |
| Reverse | `space-x-`/`divide-x-` → додає `rtl:space-x-reverse` / `rtl:divide-x-reverse` |
| Курсори | `cursor-w-resize` ↔ `cursor-e-resize` під `rtl:` |
| Пропси | `side="right"` → `side="inline-end"`, `side="left"` → `side="inline-start"` (саме тому Base UI має ці значення) |
| Анімації | `data-[side=inline-start]:slide-in-from-right` → `...-from-end` тощо |
| Sentinel | клас `cn-rtl-flip` у нашому коді замінюється на `rtl:rotate-180` — штатний механізм для дзеркалення шевронів/стрілок |

**Граблі:** локально встановлений `shadcn@4.19.0` **не запускається** — падає на
`TypeError: o.deepPartial is not a function` (бандл CLI розрахований на zod 3, а в
воркспейсі піднятий zod 4). Тобто мігрувати треба через `pnpm dlx shadcn@latest`,
не через `pnpm exec shadcn`.

## Аудит: що доведеться чіпати

**337 напрямкових входжень у 75 файлах:**

| Скоуп | Входжень | Файлів | Коментар |
| --- | --- | --- | --- |
| `libs/ui/src` | 213 | 34 | з них ~150 — вендорені примітиви, тобто чистий `migrate rtl` |
| `apps/web/src` | 115 | 34 | 31 з них — календар |
| `apps/platform-web/src` | 9 | 7 | майже безкоштовно |

Топ-файли: `ui/sidebar.tsx` (13), `ui/dropdown-menu.tsx` (11), `ui/context-menu.tsx` (10),
`calendar/time-grid.tsx` (11), `ui/alert.tsx` (8), `calendar/event-chip.tsx` (9),
`calendar/agenda-list.tsx` (8).

Найчастіші класи: `pr-1`×22, `border-l-`×18, `pl-1`×15, `-right-2`×15, `-left-2`×15,
`text-left`×14, `right-0`×13, `left-0`×13, `ml-auto`×11.

### Зона A — ручна, шел

| Місце | Проблема |
| --- | --- |
| `ui/sidebar.tsx:226` | `fixed ... data-[side=left]:left-0 / data-[side=right]:right-0` — **фізичне**. Під `dir="rtl"` сайдбар лишиться зліва. Це відома діра реєстру: механізм `side` у shadcn-сайдбарі фізичний, і `migrate rtl` перетворить `left-0`→`start-0`, але семантика пропа `side="left"` лишиться неоднозначною. Потрібне рішення: або логічні `start`/`end` наскрізь, або флип пропа за напрямком |
| `ui/sidebar.tsx:281-286` (`SidebarRail`) | `-right-4`, `left-0`, `cursor-w-resize`/`e-resize`, `-translate-x-1/2` — уже має `ltr:`/`rtl:` варіанти, але обидва однакові (`ltr:-translate-x-1/2 rtl:-translate-x-1/2`) — тобто RTL там недороблений навіть у реєстрі |
| `hooks/use-resizable-panel-width.ts:125,137,160` | **Фізична геометрія в JS**: `delta = event.clientX - drag.startX`, `grow: 'right'\|'left'`, і стрілки `ArrowLeft/ArrowRight` зі знаком. У RTL знак треба інвертувати. Виправлення локальне — одна функція `resolveDragWidth` + `onKeyDown` |
| `components/resize-handle.tsx` | `edge: 'left'\|'right'` → `right-0 translate-x-1/2` / `left-0 -translate-x-1/2`. Проп треба зробити логічним (`start`/`end`) і пробросити напрямок |
| `components/context-panel-slot.tsx:179-194` | `border-l`, `fixed right-0`, `md:right-auto`, `edge="left" grow="left"` — третя колонка живе на фізичному правому краю |
| `apps/web/src/app-shell/app-shell.tsx` | `-ml-2` на тригері, `ml-auto` на групі дій хедера — механічно |
| `ui/toast.tsx:37-42,91-103` | позиції `'top-right'`/`'bottom-right'` + swipe-напрямки `data-[swipe-direction=left/right]` з `translateX`. Base UI сам повертає фізичні напрямки свайпу — треба звірити поведінку під RTL |
| `ui/table.tsx:27` | лінійка `after:left-3` / `after:right-3` на першій/останній комірці — механічно, але масивний один рядок класів |

### Зона B — ручна, іконки

~33 напрямкові іконки `lucide-react`: `ChevronRightIcon`×14, `ChevronLeftIcon`×6,
`ChevronRight/Left`×4, `ArrowRight`×5, `ArrowLeft`×2, `PanelLeftIcon`/`PanelRightIcon`×4.

Кожну треба або дзеркалити (`cn-rtl-flip` → `rtl:rotate-180`), або **не** дзеркалити —
рішення посимвольне: шеврон «далі в пагінації» дзеркалиться, стрілка «зростання метрики»
ні. `ArrowDown`/`ArrowUp`/`ChevronDown`/`ChevronUp` (17 штук) не чіпаються.

### Зона C — календар, найдорожча

5681 рядок у `apps/web/src/components/calendar/` з абсолютним позиціюванням і drag&drop:

| Файл | Що ламається |
| --- | --- |
| `layout-overlaps.ts:72-80` | віддає `{ left: 'N%', width: 'calc(N% - 2px)' }` для колонок перетину подій → `insetInlineStart`. Є тест `layout-overlaps.test.ts`, що асертить саме `style.left` — його теж переписувати |
| `month-drag.ts:57` | `column = Math.floor(((x - rect.left) / rect.width) * 7)` — у RTL колонка тижня рахується **задом наперед** |
| `use-event-drag.ts:56-59` | edge-автоскрол `x < rect.left + EDGE_ZONE` / `x > rect.right - EDGE_ZONE` — семантика «до попереднього/наступного дня» інвертується |
| `time-grid.tsx` (11 входжень), `event-chip.tsx` (9), `agenda-list.tsx` (8), `month-grid.tsx` (3) | шкала годин, чіпи, гаттер |

Плюс: `Intl.DateTimeFormat` для `ar` за замовчуванням дає **арабо-індійські цифри** (٠١٢٣),
а `ar-SA` — ще й ісламський календар. Для Ізраїлю потрібні явні `ar-IL-u-nu-latn-ca-gregory`
і `he-IL`. Перший день тижня для обох — неділя; це вже налаштовуване
(`preferences.weekStartsOn` → `calendar-date.ts:140`), тож окремої роботи не потребує.

### Зона D — bidi-гігієна даних

Це те, що ламається не версткою, а алгоритмом Unicode Bidi, і чого жоден `migrate` не
зловить. Усе, що є LTR-контентом усередині RTL-абзацу, треба ізолювати (`<bdi>` або
`dir="ltr"` + `unicode-bidi: isolate`):

- телефони (`components/form/phone/`, `libphonenumber-js`) — класичний випадок «`+972` поїхав у кінець»;
- e-mail, URL, ID сутностей;
- **людиночитні номери клієнтів** (counter-table з `docs/customers.md`) — префікс+число;
- діапазони («14:00 – 15:30»), версії, коди помилок.

Зараз у фронтах **нуль** `<bdi>` / `dir=` (єдиний `dir=` — прокидання в `sidebar.tsx:179`).

### Зона E — шрифти

`libs/ui/src/styles.css:13` тягне `@fontsource-variable/inter`, стек —
`'Inter Variable', ui-sans-serif, system-ui, …`. Перевірено `metadata.json`: сабсети Inter —
`latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext, vietnamese`. **Ні івриту, ні
арабської.** Тобто зараз обидві мови впадуть на системний фолбек із розʼїханими метриками.

Треба: `@fontsource-variable/noto-sans-hebrew` (або Heebo/Rubik) + арабський
(`noto-sans-arabic`, IBM Plex Sans Arabic, Cairo), підключені через `unicode-range` у
тому ж стеку, і **збільшений `line-height` для арабської** — діакритика й підрядкові
елементи не влазять у наші 36px-контроли без ревізії.

## План робіт (оцінка)

| Пакет | Обсяг | Оцінка |
| --- | --- | --- |
| **R-0. Інфраструктура напрямку** — `SUPPORTED_LOCALES`/`UserLocaleSchema`/`settings` + `he`/`ar`; `<DirectionProvider direction={i18n.dir()}>` на корені обох фронтів; синхронізація `<html lang dir>`; language switcher (патерн theme-switcher); шрифтовий стек | S | 1–1.5 дн |
| **R-1. Механічна конверсія** — `pnpm dlx shadcn@latest migrate rtl` по трьох скоупах + ревізія diff-у (25 файлів мають «ЛОКАЛЬНА ПРАВКА реєстру» — звірити, що міграція їх не зачепила) | S–M | 1–1.5 дн |
| **R-2. Шел** — sidebar/rail/resize-handle/context-panel/toast + `useResizablePanelWidth` під напрямок | M | 2–3 дн |
| **R-3. Іконки** — 33 місця, посимвольне рішення + sentinel `cn-rtl-flip` | S | 0.5 дн |
| **R-4. Календар** — layout-overlaps, month-drag, use-event-drag, time-grid, month-grid + переписати 3 тести | L | 3–4 дн |
| **R-5. Bidi-гігієна** — `<bdi>`-обгортки, Intl з явним `nu-latn`, формати дат/чисел | M | 1–2 дн |
| **R-6. QA** — немає жодного visual-regression; `pnpm web:test` покриває лише календарну логіку (8 файлів). Потрібен щонайменше pseudo-RTL прохід руками по всіх area | M | 1–2 дн |
| — | | **8–13 дн** |

**Окремо, не RTL:** переклад **1109 ключів** (710 без `playground.json`) × 2 мови.
Це вартість I18N-4, а не RTL, і вона від RTL не залежить.

## Ризики й рішення, які треба прийняти до старту

1. **`libs/ui` спільна.** Платформений портал (операторський, 28 файлів) отримає всі зміни
   автоматично. Питання: чи робимо platform-web RTL-здатним (майже безкоштовно — 9 входжень),
   чи жорстко LTR (`<DirectionProvider direction="ltr">` на корені). Рекомендація: **жорстко
   LTR**, оператори свої, а кожна RTL-поверхня — це QA-борг назавжди.
2. **`shadcn diff` після міграції.** Після конверсії вендорені примітиви розійдуться з реєстром
   на всіх 337 місцях — `shadcn diff` стане шумним. Пом'якшує те, що ми ввімкнемо
   `"rtl": true` у `components.json`, і CLI застосує той самий трансформ до того, що тягне
   з реєстру. Це треба перевірити на одному примітиві **до** масової міграції.
3. **`side="left"/"right"` у sidebar.** Реєстровий механізм фізичний. Рішення (логічні
   `start`/`end` vs флип пропа) впливає на `app-shell.tsx` обох фронтів.
4. **Дві RTL-мови ≠ одна.** Іврит і арабська дзеркаляться однаково, але розходяться в
   цифрах, календарі, шрифтових метриках і довжині рядків. Якщо цільова аудиторія —
   ізраїльський ринок, `he` + `ar-IL` + `en` — це **три** локалі в QA-матриці.
5. **Арабська довша за англійську** на ~20–25% у UI-рядках; наші 36px-контроли й
   `whitespace-nowrap` у гріді/фільтрах треба перевірити pseudo-локаллю (це вже записано
   в I18N-4 як «pseudo-locale (подовжені рядки)»).
6. **Дзеркалити не все.** Медіаплеєри, графіки з часовою віссю, прогрес завантаження,
   код/термінал лишаються LTR. У нас це: графіки дашборда, часова шкала календаря
   (годинна вісь), `kbd`.

## Що перевірити далі (не робилося в цьому дослідженні)

- Прогнати `shadcn migrate rtl` на **одному** файлі в гілці й подивитися реальний diff.
- Поведінка Base UI `toast` swipe під `DirectionProvider` (чи повертає логічний напрямок).
- `libs/ui/src/lib/date-value.ts` — сегментований date-input будується з `Intl`-частин;
  порядок сегментів у RTL треба подивитися живцем.
- `libs/ui/src/lib/format.ts:75` — захардкожений `'en-GB'` у форматері (баг локалі,
  не RTL, але спливе разом з ним).
