# Реєстр UI-джерел: звідки що беремо

Довідник на один випадок: «треба компонент/блок — де його взяти, щоб не зламати стек».
Складено 2026-08-24 за фактичною перевіркою реєстрів (усі посилання і коди відповідей —
живі на дату запису).

Наш стек: **shadcn/ui на Base UI, стиль `base-nova`, Tailwind 4**, вендорений код у
`libs/ui/src/components/ui/`, тема — `libs/ui/src/styles.css` (палітра HeroUI, див.
`docs/migrate-web.md` §9 UI-2). Правила стека — `CLAUDE.md`, правило 12.

---

## 1. Порядок вибору джерела

1. **`@shadcn` (base-nova)** — дефолт. Ставимо без питань: це рідний стиль нашого
   `components.json`, ті самі токени, ті самі конвенції (`data-slot`, `cva`, `render`).
2. **`@coss` (Cal.com)** — коли примітива немає в `@shadcn`. Той самий Base UI під капотом,
   але **інша родина обгорток** — брати точково і за чеклістом §5.
3. **`@reui`** — джерело ідей і безкоштовних прикладів; блоки платні (401 без ліцензії).
4. **Галереї-референси** (Tailwind Plus, Origin UI, 21st.dev, Kibo, Tremor) — дивимось,
   переносимо руками, як залежність не підключаємо.

Конфіг реєстрів живе в `libs/ui/components.json` і `apps/*/components.json`:

```jsonc
"registries": {
  "@reui": "https://reui.io/r/{style}/{name}.json",
  "@coss": "https://coss.com/ui/r/{name}.json"   // додати, коли знадобиться
}
```

---

## 2. Що вже вендеровано у нас (31 примітив)

`libs/ui/src/components/ui/`: alert-dialog · avatar · badge · button · card · checkbox ·
combobox · dialog · dropdown-menu · empty · field · input · input-group · item · label ·
pagination · progress · scroll-area · select · separator · sheet · sidebar · skeleton ·
spinner · switch · table · tabs · textarea · toast · toggle · toggle-group · tooltip

Хуки: `hooks/use-mobile.ts`. Власні (не з реєстру): `theme-switcher.tsx`, `user-identity.tsx`,
`components/data-grid/**`, `components/form/**`.

**Локальні правки реєстру** (позначені коментарем «ЛОКАЛЬНА ПРАВКА реєстру») — `toast`
(позиції), `checkbox` (indeterminate), `button` (пігулка, суцільний destructive, метрика,
фокус), `input`/`textarea`/`select`/`input-group` (біла поверхня, тінь, висота 36px).
Плюс наскрізна заміна фокус-кільця на `ring-2` у 14 файлах.

---

## 3. Примітиви: де що є

### 3.1 `@shadcn` — доступні, але ще не встановлені

[Документація](https://ui.shadcn.com/docs/components) · ставити: `npx shadcn@latest add <name>`
(з теки `libs/ui`).

| Компонент                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Ймовірний споживач у нас                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [accordion](https://ui.shadcn.com/docs/components/accordion) · [collapsible](https://ui.shadcn.com/docs/components/collapsible)                                                                                                                                                                                                                                                                                                                                                                                      | згортні групи в сайдбарі, коли доменних модулів стане більше |
| [breadcrumb](https://ui.shadcn.com/docs/components/breadcrumb)                                                                                                                                                                                                                                                                                                                                                                                                                                                       | хлібні крихти в хедері карток (`/users/$userId`)             |
| [command](https://ui.shadcn.com/docs/components/command)                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ⌘K-пошук по тенантах/юзерах                                  |
| [popover](https://ui.shadcn.com/docs/components/popover) · [hover-card](https://ui.shadcn.com/docs/components/hover-card)                                                                                                                                                                                                                                                                                                                                                                                            | картка юзера при наведенні в гріді                           |
| [calendar](https://ui.shadcn.com/docs/components/calendar)                                                                                                                                                                                                                                                                                                                                                                                                                                                           | фільтри за датою в гріді, заплановані сповіщення             |
| [chart](https://ui.shadcn.com/docs/components/chart)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | дашборд, статистика черг                                     |
| [radio-group](https://ui.shadcn.com/docs/components/radio-group) · [slider](https://ui.shadcn.com/docs/components/slider) · [form](https://ui.shadcn.com/docs/forms)                                                                                                                                                                                                                                                                                                                                                 | форми налаштувань (System Settings)                          |
| [drawer](https://ui.shadcn.com/docs/components/drawer)                                                                                                                                                                                                                                                                                                                                                                                                                                                               | мобільний варіант панелей (у нас зараз `sheet`)              |
| [alert](https://ui.shadcn.com/docs/components/alert)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | банер «тенант призупинено» тощо                              |
| [context-menu](https://ui.shadcn.com/docs/components/context-menu) · [menubar](https://ui.shadcn.com/docs/components/menubar) · [navigation-menu](https://ui.shadcn.com/docs/components/navigation-menu)                                                                                                                                                                                                                                                                                                             | поки без споживача                                           |
| [button-group](https://ui.shadcn.com/docs/components/button-group) · [kbd](https://ui.shadcn.com/docs/components/kbd) · [input-otp](https://ui.shadcn.com/docs/components/input-otp) · [carousel](https://ui.shadcn.com/docs/components/carousel) · [resizable](https://ui.shadcn.com/docs/components/resizable) · [aspect-ratio](https://ui.shadcn.com/docs/components/aspect-ratio) · [sonner](https://ui.shadcn.com/docs/components/toast) · [native-select](https://ui.shadcn.com/docs/components/native-select) | за потреби                                                   |

### 3.2 `@coss` — те, чого в `@shadcn` НЕМАЄ

[Документація](https://coss.com/ui/docs) · реєстр `https://coss.com/ui/r/{name}.json`
(вільний). Дизайн-система Cal.com на тому самому Base UI.

| Компонент                                                                                                                                                                                  | Навіщо нам                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [number-field](https://coss.com/ui/docs/components/number-field)                                                                                                                           | ліміти, квоти, білінг                                                                         |
| [meter](https://coss.com/ui/docs/components/meter)                                                                                                                                         | використання квоти (на відміну від `progress` — саме вимірювання, не прогрес)                 |
| [otp-field](https://coss.com/ui/docs/components/otp-field)                                                                                                                                 | 2FA, підтвердження пошти                                                                      |
| [fieldset](https://coss.com/ui/docs/components/fieldset) · [group](https://coss.com/ui/docs/components/group) · [frame](https://coss.com/ui/docs/components/frame)                         | секції довгих форм налаштувань                                                                |
| [toolbar](https://coss.com/ui/docs/components/toolbar)                                                                                                                                     | панель дій над грідом                                                                         |
| [preview-card](https://coss.com/ui/docs/components/preview-card)                                                                                                                           | попередній перегляд сутності по наведенню                                                     |
| [autocomplete](https://coss.com/ui/docs/components/autocomplete) · [checkbox-group](https://coss.com/ui/docs/components/checkbox-group) · [menu](https://coss.com/ui/docs/components/menu) | альтернативи нашим `combobox`/`checkbox`/`dropdown-menu` — брати лише якщо наших не вистачить |

> **Практичний висновок із розбору їхніх `select` і `input`** (UI-7, `docs/migrate-web.md`):
> перш ніж тягнути компонент, перевір, чи потрібна поведінка вже не є **пропом у нашому**.
> `alignItemWithTrigger` (попап не накриває тригер) виявився в обох — це проп Base UI, а не
> фіча бібліотеки. З coss варто брати не файли, а **точкові прийоми**: ширина попапа
> `min-w-(--anchor-width)`, глушник autofill, скидання `::-webkit-search-cancel-button`.
> | [segmented-control](https://coss.com/ui/docs/components/segmented-control) | перемикач режимів (у нас цю роль грає `toggle-group`) |

⚠️ `toast`, `select`, `combobox`, `dialog` тощо в них теж є — **не брати**: у нас вони вже
є з `@shadcn`, а імена файлів збігаються (див. §5).

---

## 4. Блоки і шаблони: де що є

### 4.1 `@shadcn` — сторінкові блоки (безкоштовно, наш стиль)

[Галерея](https://ui.shadcn.com/blocks) · переглянути код: `npx shadcn@latest view @shadcn/<name>`

| Категорія            | Що всередині                                                                                                                                                                                                                                                                                                                                                                                                                           | Посилання                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Сайдбари, 16 шт.** | `sidebar-01` секції · `sidebar-02` згортні секції · `sidebar-03`/`05` підменю · `sidebar-04` плаваючий · `sidebar-06` дропдауни · **`sidebar-07` іконковий рейл — наш поточний** · `sidebar-08` inset із вторинною навігацією · `sidebar-09` вкладені рейли · `sidebar-10`/`13` у поповері/діалозі · `sidebar-11` дерево файлів · `sidebar-12` календар · `sidebar-14`/`15` праворуч / з обох боків · `sidebar-16` зі «липким» хедером | [/blocks/sidebar](https://ui.shadcn.com/blocks/sidebar)     |
| **Дашборд**          | `dashboard-01`: сайдбар + графіки + таблиця                                                                                                                                                                                                                                                                                                                                                                                            | [/blocks/dashboard](https://ui.shadcn.com/blocks/dashboard) |
| **Автентифікація**   | `login-01…05`, `signup-01…05` (форма, дві колонки з обкладинкою, лише email, соцпровайдери)                                                                                                                                                                                                                                                                                                                                            | [/blocks/login](https://ui.shadcn.com/blocks/login)         |
| **Графіки**          | ~70 блоків `chart-*` (area/bar/line/pie/radar/radial + тултіпи)                                                                                                                                                                                                                                                                                                                                                                        | [/blocks](https://ui.shadcn.com/blocks)                     |

### 4.2 `@reui` — сторінкові блоки (**платні**, галерея відкрита)

[Галерея](https://reui.io/blocks) · JSON блоку віддає **401** без `REUI_LICENSE_KEY`.
Стиль `base-nova` підтримують, тобто після покупки лягли б у наш стек.

| Категорія                                     | К-сть      | Посилання                                                                                                                                                                            |
| --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App Shell (каркаси застосунку)                | 20         | [/application/app-shell](https://reui.io/blocks/application/app-shell)                                                                                                               |
| Navbar (верхні меню)                          | 13         | [/application/navbar](https://reui.io/blocks/application/navbar)                                                                                                                     |
| Settings                                      | 16         | [/application/settings](https://reui.io/blocks/application/settings)                                                                                                                 |
| Stats (KPI-картки)                            | 15         | [/application/stats](https://reui.io/blocks/application/stats)                                                                                                                       |
| Dialog                                        | 14         | [/application/dialog](https://reui.io/blocks/application/dialog)                                                                                                                     |
| Empty State                                   | 14         | [/application/empty-state](https://reui.io/blocks/application/empty-state)                                                                                                           |
| Card                                          | 43         | [/application/card](https://reui.io/blocks/application/card)                                                                                                                         |
| Chart                                         | 30         | [/application/chart](https://reui.io/blocks/application/chart)                                                                                                                       |
| Form                                          | 12         | [/application/form](https://reui.io/blocks/application/form)                                                                                                                         |
| List                                          | 11         | [/application/list](https://reui.io/blocks/application/list)                                                                                                                         |
| Sheet                                         | 11         | [/application/sheet](https://reui.io/blocks/application/sheet)                                                                                                                       |
| Kanban Board                                  | 10         | [/application/kanban-board](https://reui.io/blocks/application/kanban-board)                                                                                                         |
| Schedule / Event Calendar / Gantt             | 10 / 6 / 4 | [/schedule](https://reui.io/blocks/application/schedule) · [/event-calendar](https://reui.io/blocks/application/event-calendar) · [/gantt](https://reui.io/blocks/application/gantt) |
| Profile (переважно self-service налаштування) | 9          | [/application/profile](https://reui.io/blocks/application/profile)                                                                                                                   |
| Onboarding                                    | 9          | [/application/onboarding](https://reui.io/blocks/application/onboarding)                                                                                                             |
| Dashboard                                     | 8          | [/application/dashboard](https://reui.io/blocks/application/dashboard)                                                                                                               |
| Auth                                          | 20         | [/application/auth](https://reui.io/blocks/application/auth)                                                                                                                         |

**Безкоштовна частина ReUI** — 1072 позиції `c-*`: це не бібліотека, а **приклади
використання** на наших же компонентах (`registryDependencies: ["avatar"]` тощо). Корисні
як зразок композиції, відкриваються прямо як JSON:

- [c-item-12](https://reui.io/r/base-nova/c-item-12.json) — стрічка активності з аватарами й діями
- [c-avatar-16](https://reui.io/r/base-nova/c-avatar-16.json) — аватар із деталями юзера й бейджем
- [c-popover-6](https://reui.io/r/base-nova/c-popover-6.json) — картка юзера в поповері
- [c-item-9](https://reui.io/r/base-nova/c-item-9.json) — рядки учасників із ролями і діями
- [c-dropdown-menu-14](https://reui.io/r/base-nova/c-dropdown-menu-14.json) — меню профілю з перемикачем теми

### 4.3 `@coss` — Particles (безкоштовно)

[Particles](https://coss.com/ui/particles) — **508** дрібних патернів `p-*` (не сторінкові
блоки, а варіанти застосування примітива): `p-button` 40, `p-input-group` 28, `p-calendar` 25,
`p-select` 23, `p-slider` 23, `p-group` 22, `p-badge` 20, `p-combobox` 20, `p-field` 18,
`p-autocomplete` 16, `p-tabs` 15, `p-drawer` 14, `p-toast` 13, `p-number-field` 11,
`p-date-picker` 9, `p-otp-field` 9 та інші. Формат — `https://coss.com/ui/r/p-<name>-<n>.json`.

### 4.4 Референси без встановлення

| Джерело                                                                                                                                                                 | Що там                                                                                                                                                                                  | Ціна            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| [Tailwind Plus → Application UI](https://tailwindcss.com/plus/ui-blocks/application-ui)                                                                                 | першоджерело більшості патернів; окремо цінні [Detail screens](https://tailwindcss.com/plus/ui-blocks/application-ui/page-examples/detail-screens) — з них узята розкладка наших карток | платно          |
| [Kibo UI](https://www.kibo-ui.com/components)                                                                                                                           | важкі доменні компоненти: gantt, kanban, календар; справжній реєстр                                                                                                                     | безкоштовно     |
| [Origin UI](https://originui.com)                                                                                                                                       | ~500 дрібних патернів                                                                                                                                                                   | безкоштовно     |
| [21st.dev](https://21st.dev)                                                                                                                                            | спільнотний каталог                                                                                                                                                                     | безкоштовно     |
| [Tremor Blocks](https://blocks.tremor.so)                                                                                                                               | дашборди й KPI                                                                                                                                                                          | частково платно |
| [shadcnblocks.com](https://www.shadcnblocks.com) · [tailark.com](https://tailark.com/blocks)                                                                            | великі бібліотеки блоків                                                                                                                                                                | платно          |
| [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) · [Kiranism/next-shadcn-dashboard-starter](https://github.com/Kiranism/next-shadcn-dashboard-starter) | живі адмінки на shadcn — читати код                                                                                                                                                     | безкоштовно     |

---

## 5. Чекліст: беремо компонент НЕ з `@shadcn`

1. **Імʼя файла не повинно збігатися** з нашим у `libs/ui/src/components/ui/` — інакше CLI
   перезапише наш вендорений код разом із локальними правками, а місця виклику зламаються
   (у `@coss` частини звуться інакше: `SelectPopup` замість нашого `SelectContent`).
2. **Прогрепати на невідомі токени.** Перевірено: компоненти `@coss` посилаються на
   `info` і `destructive-foreground`, яких у нашій темі немає — або додати змінні, або
   замінити на наші (`primary`, `text-white`).
3. **Вирівняти метрику й фокус** під наші: висота контролів 36px (`sm` 32, `xs` 28, `lg` 40),
   фокус — суцільне `ring-2` кольору `--ring` (у `@coss` — адаптивна висота `min-h-9 sm:min-h-8`
   і `ring-[3px]` при 24% непрозорості).
4. **Позначити джерело** коментарем у файлі — так само, як ми позначаємо локальні правки.
5. **Не запускати** `add @coss/ui`, `init @coss/style`, `add --all` — вони тягнуть увесь
   набір поверх нашого і перезаписують тему та шрифти.

---

## 6. Що з цього вже застосовано

| Рішення                                                              | Джерело                                  | Де                                                 |
| -------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| Розкладка шела (бренд угорі, профіль у футері, `collapsible="icon"`) | `@shadcn/sidebar-07`                     | `app-layout.tsx` обох фронтів, UI-3                |
| Розкладка карток `/users/$userId` і `/tenants/$tenantId`             | Tailwind Plus → Detail screens           | `pages/user-detail.tsx`, `pages/tenant-detail.tsx` |
| Палітра, тіні, шрифт Inter                                           | HeroUI (їхній MCP `get_theme_variables`) | `libs/ui/src/styles.css`, UI-2                     |
| Пігулкові кнопки, суцільний danger, метрика 36px                     | HeroUI `button.css` / `input.css`        | `ui/button.tsx`, поля                              |
