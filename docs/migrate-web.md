# Задача: `apps/web` з HeroUI на shadcn/ui + спільний `libs/ui`

Другий і останній хід UI-міграції. Пілот на `apps/platform-web` завершено й прийнято 2026-08-23
(`docs/migrate.md`). Тут — `apps/web` (tenant-адмінка, React 19 + Vite 7 + Tailwind 4 +
TanStack Router/Query), і разом із нею три речі, яких пілот свідомо не робив:

1. **Жодного сліду HeroUI** — не лише імпортів, а й понять: токенів, назв ролей, CSS-override'ів,
   компонувальних звичок. Мертві поняття (`surface`, `accent-soft`, `danger`, `field-*`)
   не «мапляться», а **зникають**, поступаючись семантиці shadcn (§4).
2. **Кустарні компоненти замінюються готовими з реєстру** — їх у застосунку набагато більше, ніж
   два костилі гріда, заради яких затівався пілот. Повний реєстр — §3.2.
3. **Спільний `libs/ui` для обох фронтів** — і зробити його треба **до** міграції web, а не після
   (обґрунтування — W2).

> **Гейт.** Виконувати після мержу гілки пілота (`dev-migrate-shadcn`): план спирається на вже
> вендорені й прийняті компоненти `apps/platform-web/src/components/ui/`.

---

## 0. Що дає пілот даром

13 файлів у двох застосунках були **побайтово однакові** — вони переїхали в `platform-web` копією
на MT-3 і відтоді не розходилися (перевірено `diff` проти `074ea18`, коміта перед міграцією):

| Файл (`src/…`)                                                                                       | Різниця | Що це означає                                         |
| ---------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------- |
| `data-grid/{create-data-grid,data-grid,filters}.tsx`, `data-grid/{sort,types}.ts`                    | 0       | Готова мігрована версія вже існує                     |
| `data-grid/{use-data-grid-filters,use-data-grid-selection,data-grid-query}.ts`                       | 0       | HeroUI там немає взагалі                              |
| `form/{form-text-field,form-password-field}.tsx`, `form/server-error.ts`                             | 0       | Готова мігрована версія вже існує                     |
| `form/form-select.tsx`                                                                               | 0       | Але в пілоті **видалений** як мертвий код — тут живий |
| `theme-switcher.tsx`, `lib/error-toast.ts`, `lib/format.ts`, `lib/page-items.ts`, `api/api-error.ts` | 0       | Готові / нейтральні                                   |

Саме цей факт і робить `libs/ui` не абстрактною «гарною ідеєю», а описом того, що вже є в репо:
дві копії одного коду, які тримає в синхроні лише дисципліна.

---

## 1. Зафіксовані рішення

W2 і W9 **закриті користувачем 2026-08-24**: беремо реєстровий `sidebar` і робимо UI-0 (спільний
`libs/ui`) ПЕРЕД міграцією web. Решта — рекомендації плану, чинні доти, доки не переглянуті явно.

### W1. Перегляд D1 — обидва фронти на shadcn

D1 (`docs/migrate.md`) фіксував «дві UI-бібліотеки, по одній на застосунок, і це не тимчасово».
Користувач це рішення скасував: платформа переписується в одному стилі. Наслідок — HeroUI виходить
із репо повністю (W7), правило 12 у `CLAUDE.md` згортається назад в одну бібліотеку.

### W2. `libs/ui` витягується ПЕРЕД міграцією web ✅ закрито 2026-08-24

Перша редакція плану радила відкласти спільний пакет «на потім». Це було помилкою, і ось чому:

- 9 з 29 мігрованих файлів у web — **дослівна копія** того, що вже мігровано в `platform-web`.
  Відкласти пакет означає скопіювати їх утретє, а потім рухати вчетверте, при витягуванні.
- Витягування **до** міграції перевіряється проти вже прийнятого застосунку: `platform-web`
  пройшов §7 пілота, тож якщо після переїзду в пакет щось ламається — причина рівно одна
  (переїзд), і baseline для порівняння існує. Витягування після означало б два свіжі рухи одразу.
- Тема (`:root`/`.dark`) інакше живе у двох файлах. Розʼїхатись вони можуть тихо — кольори не падають.
- shadcn CLI **штатно підтримує таку розкладку**: `aliases.ui` у `components.json` застосунку може
  вказувати на workspace-пакет (`@saas-skeleton/ui/components`), і CLI сам переписує імпорти в
  доданих файлах. Це не обхід інструмента, а його документований режим.

Тому план ділиться на дві фази: **UI-0** (витягнути `libs/ui`, споживач — `platform-web`) і
**UI-1** (мігрувати `apps/web` уже на пакет). Деталі — §5.A і §5.B.

Що йде в пакет, а що лишається в застосунках:

| У `libs/ui`                                                                    | Лишається в застосунку                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `styles.css` — тема (`:root`/`.dark`, `@theme inline`, `@layer base`)          | `index.css` застосунку: `@import` пакета + `@source`           |
| `components/ui/**` — вендеровані примітиви реєстру                             | —                                                              |
| `data-grid/**` — увесь грід (generic по `TFilters`/`TItem`)                    | Дефініції колонок/фільтрів сторінок                            |
| `form/**` — `FormTextField`, `FormPasswordField`, `FormSelect`, `server-error` | Самі форми і схеми                                             |
| `lib/utils.ts` (`cn`), `lib/page-items.ts`                                     | `lib/error-toast.ts` (тягне `i18n` застосунку), `api-error.ts` |
| `theme-switcher.tsx`                                                           | `app-layout.tsx`, `toast-host.tsx` — у застосунків різні       |
| `use-mobile` та інші хуки реєстру                                              | Усе доменне                                                    |

Спірне — `FormPhoneField` + `phone/**`: він generic (не знає про домен), але тягне `libphonenumber-js`
і `country-flag-icons`, які потрібні лише web. Пропозиція: **лишити в `apps/web`** до появи другого
споживача; пакет не має тягнути залежності заради одного застосунку.

### W3. Драйвери → `sheet`, а не `drawer`

У реєстрі `base-nova` є обидва: `sheet` (поверх `@base-ui/react/dialog`, проп `side`) і `drawer`
(поверх `@base-ui/react/drawer`, зі свайпом і snap-points, 228 рядків). Наші панелі керовані ззовні
(`isOpen`/`onClose`) і без жестів → `sheet` лягає 1:1, а `drawer` приніс би контекст snap-points,
який нічим заповнити.

### W4. `CellSwitch` — видалити

Файл існує **виключно** як обхід UI-1 (HeroUI-візуал у `inert`-обгортці + нативний `input` поверх).
Під Base UI `Switch` працює штатно, тож лишилася б обгортка на три рядки з докблоком про
неіснуючий баг. Обидва місця використання (`pages/users.tsx`, `notification-preferences.tsx`)
беруть `Switch` напряму.

### W5. Вибір країни → `Combobox` з `anchor`

`combobox` у `base-nova` має вбудовану фільтрацію (`items` + `filter`), `ComboboxEmpty` і
`ComboboxContent anchor={ref}` із шириною попапа `w-(--anchor-width)`. Це знімає **весь блок ручної
геометрії** в `country-select.tsx`: `measureAnchor()`, `crossOffset`, перевизначення
`--trigger-width` і коментар на шість рядків про те, чому inline `width` не працює.

### W6. Бренд — монохром `base-nova`

У HeroUI `accent` — синій бренд; у shadcn `accent` означає **інше** (тьмяна поверхня наведення), а
`primary` у `base-nova` монохромний. Бренд мапимо в `primary` і приймаємо монохром — так само, як
уже прийнято в `platform-web`. Власна бренд-палітра — окремий хід по темі, одразу для обох
застосунків (з `libs/ui` це буде один файл).

### W7. Тулінг і документи HeroUI — прибрати повністю

MCP-сервер `heroui-react` у `.mcp.json`, скіл (`.agents/skills/heroui-react/`, симлінк
`.claude/skills/heroui-react`, рядок у `skills-lock.json`), `@heroui/*` у `package.json` і
`pnpm-lock.yaml`, розділ у `CLAUDE.md`, статус UI-1 у `docs/frontend-ui-known-issues.md`.
`pnpm.overrides.zod` **лишається** — воно про пакет `shadcn`, не про HeroUI.

### W8. Хардкод «Close» у вендореному коді — приймаємо

`DialogContent`/`SheetContent` реєстру малюють кнопку закриття з `<span className="sr-only">Close</span>`.
Пілот це прийняв; правити — заводити локальну правку і `useTranslation` у вендорений шар.
Фіксуємо як єдиний легальний хардкод (у вендореному шарі, не в нашому коді).

### W9. Сайдбар → реєстровий `sidebar` ✅ закрито 2026-08-24

Зараз в обох застосунках сайдбар — рукописний `<aside className="w-60">` з рядком навігації і
двома рядками класів на `hover`/`active`. Замінюється реєстровим `sidebar`
(`SidebarProvider`/`Sidebar`/`SidebarMenu`/`SidebarMenuButton`/`SidebarTrigger`/`SidebarInset`).

Аргументи, на яких рішення стоїть: (1) навігація в tenant-адмінці зростатиме з кожним доменним модулем (customers,
tickets, billing) — рукописні класи `activeProps` доведеться повторювати; (2) зараз на вузькому
екрані сайдбар просто зʼїдає 240px і не ховається — `Sidebar` дає мобільний режим через `sheet`,
згортання, збереження стану і клавіатурний шорткат; (3) `SidebarMenuButton isActive` знімає
дублювання `navLinkClass`/`activeProps`.

Прийнята ціна: 730 рядків вендореного коду плюс залежності реєстру (`sheet`, `skeleton`,
`tooltip`, `use-mobile`, `separator`, `input`) заради двох посилань сьогодні. Оскільки компонент
живе в `libs/ui`, ця ціна платиться **один раз на обидва застосунки**.

Механіка: `SidebarProvider` обгортає весь `AppLayout`, контент іде в `SidebarInset`, хедер
(дзвінок, тема, меню акаунта) лишається всередині `SidebarInset` і отримує `SidebarTrigger`
ліворуч. Пункти навігації — `SidebarMenuButton isActive render={<Link/>}` (підміна елемента в
Base UI — `render`, не `asChild`), тож `navLinkClass`/`activeProps` зникають в обох застосунках.

### W10. Кустарну верстку замінити реєстровими примітивами

Реєстр `base-nova` має рівно ті компоненти, які в `apps/web` зроблені руками (§3.2):
`Item*` (медіа-обʼєкт), `Empty*` (порожні стани), `AvatarBadge` (індикатор на аватарі),
`ToggleGroup` (фільтри інбокса), `Tooltip`, `Spinner`, `Skeleton`, `ScrollArea`.

### W11. `FileDropzone` — лишається наш, але перебудований

Дропзони в реєстрі немає (перевірено пошуком по `@shadcn`) — компонент лишається власним. Але
його оболонка переписується на `Empty` + `Button` + прихований `<input type="file">`, тобто зникає
костиль `role="button"` + `tabIndex` + `onKeyDown` на `<div>`: клавіатуру й фокус дає справжня кнопка.

---

## 2. Перевірений інвентар

`grep -rln "@heroui" apps/web/src` → **29 файлів** (28 коду + `index.css`), 3336 рядків.

### 2.1 Приходить із `libs/ui` після UI-0 (9 файлів)

`data-grid/{data-grid,create-data-grid,filters}.tsx`, `data-grid/{types,sort}.ts`,
`form/{form-text-field,form-password-field}.tsx`, `theme-switcher.tsx`, `lib/error-toast.ts`
(останній — з підстановкою `i18n` застосунку, див. §5.A.4).

### 2.2 Переписується (20)

| Файл                                         | HeroUI зараз                                                | Головне у переписуванні                                                          |
| -------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `index.css`                                  | `@import '@heroui/styles'` + ~70 рядків override'ів         | `@import '@saas-skeleton/ui/styles.css'` + `@source` (§4)                        |
| `main.tsx`                                   | `attribute={['class','data-theme']}`                        | `attribute="class"`; `storageKey` лишається `saas_theme`                         |
| `app-layout.tsx`                             | `Dropdown`, рукописний `<aside>`                            | `Sidebar*` (W9) + `DropdownMenu` + `NotificationBell`                            |
| `toast-host.tsx`                             | два `Toast.Provider` з різними `placement`                  | Два регіони на Base UI — §3.3                                                    |
| `realtime/notification-toast.ts`             | `ToastQueue`                                                | `createToastManager<…>()`; `add/close` збігаються, `clear()` → `close()`         |
| `notifications/notification-toast-item.tsx`  | `Toast` + гасіння стилів через `!`                          | Композиція `Toast`+`ToastContent`; `!`-override'и зникають                       |
| `notifications/notification-panel.tsx`       | `Button, Drawer, Spinner`                                   | `Sheet` (W3) + `ToggleGroup` для фільтрів + `Empty` + `ScrollArea`               |
| `notifications/notification-card.tsx`        | `Dropdown`, `role="button"`, інлайн-SVG                     | `Item*` + `DropdownMenu` + `Item render={<button/>}` у `plain`-режимі            |
| `notifications/notification-item.tsx`        | —                                                           | Тільки токени                                                                    |
| `notifications/notification-preferences.tsx` | `Button, Spinner`                                           | `Switch` (W4), `Empty`, `ArrowLeftIcon`                                          |
| `notifications/notification-bell.tsx`        | сирий `<button>` + інлайн-SVG                               | `Button variant="ghost" size="icon"` + `Badge` + `BellIcon`                      |
| `activity/activity-drawer.tsx`               | `Button, Drawer, Spinner`                                   | `Sheet` + `Empty` + `Item`-таймлайн                                              |
| `user-identity.tsx`                          | `Avatar` compound + ручний медіа-обʼєкт                     | `Item*` + `Avatar` (проп `size` **є**: `sm/default/lg`) + `AvatarBadge`          |
| `presence-dot.tsx`                           | абсолютний `<span>` + `title`                               | `AvatarBadge` + `Tooltip` (W10)                                                  |
| `file-upload/file-dropzone.tsx`              | `role="button"` `<div>` + прихований input                  | `Empty` + `Button` + input (W11)                                                 |
| `change-avatar-modal.tsx`                    | `Avatar, Label, Modal, ProgressBar`                         | `Dialog*` + `Progress*` (`isIndeterminate` → `value={null}`)                     |
| `change-password-modal.tsx`                  | `Button, Modal`                                             | `Dialog*`                                                                        |
| `create-user-modal.tsx`                      | `Button, Modal`                                             | `Dialog*`; всередині `FormSelect` + `FormPhoneField`                             |
| `form/form-select.tsx`                       | `FieldError, Label, ListBox, Select`                        | Пишеться наново (у пілоті видалений) — у `libs/ui`                               |
| `form/form-phone-field.tsx`                  | `FieldError, InputGroup, Label, TextField`                  | `Field` + `InputGroup` + `InputGroupAddon`; хаки `border-e-0/ps-1/pe-1` зникають |
| `form/phone/country-select.tsx`              | `Autocomplete, EmptyState, ListBox, SearchField, useFilter` | `Combobox` з `anchor` (W5)                                                       |
| `data-grid/cell-switch.tsx`                  | `Switch` + `inert` + нативний input                         | **Видаляється** (W4)                                                             |
| `pages/users.tsx`                            | `Chip, toast`                                               | `Badge`; `toast.danger(…)` → `toast.add({ type: 'error', … })`                   |
| `pages/dashboard.tsx`                        | `Card, Spinner`                                             | `Card*`, `Spinner`, `Empty`                                                      |
| `pages/login.tsx`                            | `Button, Card`                                              | За зразком мігрованого `platform-web`                                            |

**Поза grep-ом, але буде зачеплено свіпом токенів:** `activity/activity-message.tsx`,
`notifications/notification-message.tsx` (`text-link`), `file-upload/file-dropzone.tsx`.

---

## 3. Мапа заміни

### 3.1 Компоненти (поверх пілотної мапи в `docs/migrate.md` §3)

| HeroUI                                                | shadcn / Base UI                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `Modal.Backdrop/Container/Dialog`                     | `Dialog` + `DialogContent/Header/Title/Footer`                          |
| `Drawer.*`                                            | `Sheet` + `SheetContent side="right"` (W3)                              |
| `ProgressBar` + `Track/Fill/Output`                   | `Progress` + `ProgressTrack/Indicator/Value/Label`                      |
| `Switch` + `Content/Control/Thumb`                    | `Switch` (`checked`, `onCheckedChange`)                                 |
| `Autocomplete`+`useFilter`+`SearchField`+`EmptyState` | `Combobox*` (фільтрація вбудована) + `ComboboxEmpty`                    |
| `ToastQueue`                                          | `createToastManager<Data>()`                                            |
| `Toast.Provider queue= placement=`                    | `ToastProvider toastManager= limit=` + `ToastPortal`/`ToastViewport`    |
| `Chip`                                                | `Badge`                                                                 |
| `Avatar` (compound)                                   | `Avatar`/`AvatarImage`/`AvatarFallback` (+`AvatarBadge`, `AvatarGroup`) |

### 3.2 Реєстр кустарного коду (головне доповнення цієї редакції)

| #   | Кустарне зараз                                                                     | Файл                                           | Заміна                                                         | Що зникає                                   |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| 1   | `SelectionCheckbox`: `inert`-обгортка + нативний input поверх                      | `data-grid/data-grid.tsx`                      | `Checkbox` реєстру                                             | Костиль UI-1 (приїде з `libs/ui`)           |
| 2   | `createPortal` чекбокса шапки в `<thead>`                                          | `data-grid/data-grid.tsx`                      | Штатна композиція                                              | Портал (приїде з `libs/ui`)                 |
| 3   | `CellSwitch`: `inert` + нативний `input[role=switch]`                              | `data-grid/cell-switch.tsx`                    | `Switch`                                                       | **Файл цілком**                             |
| 4   | Ручний вимір попапа: `measureAnchor`, `crossOffset`, `--trigger-width`             | `phone/country-select.tsx`                     | `ComboboxContent anchor={fieldRef}`                            | ~40 рядків геометрії й коментарів           |
| 5   | `role="button"` + `tabIndex` + `onKeyDown` на `<div>`                              | `file-dropzone.tsx`                            | `Empty` + справжній `<Button>`                                 | Ручна імітація кнопки                       |
| 6   | Те саме, вдруге                                                                    | `notification-card.tsx`                        | `Item render={<button/>}` у `plain`                            | Ручна імітація кнопки                       |
| 7   | Медіа-обʼєкт руками: `min-w-0`, `truncate`, `title`, коментар про `min-width:auto` | `user-identity.tsx`                            | `Item`+`ItemMedia`+`ItemContent`+`ItemTitle`+`ItemDescription` | Ручна типографіка й обрізання               |
| 8   | Абсолютний `<span>` з `border-2 border-background` + `title`                       | `presence-dot.tsx`                             | `AvatarBadge` + `Tooltip`                                      | Ручне позиціювання і псевдо-тултіп          |
| 9   | Порожні/помилкові стани як `<p className="py-8 text-center text-sm text-muted">`   | 5 місць (панель, драйвер, преференси, дашборд) | `Empty`+`EmptyTitle`/`EmptyDescription`/`EmptyMedia`           | Розсипана верстка станів                    |
| 10  | Фільтри інбокса: три `Button` із ручним `variant={active ? … : …}`                 | `notification-panel.tsx`                       | `ToggleGroup`/`ToggleGroupItem`                                | Ручне керування вибраним станом             |
| 11  | Рукописний `<aside>` + `navLinkClass`/`activeProps`                                | `app-layout.tsx` (обидва фронти)               | `Sidebar*` (W9)                                                | Ручна навігація й відсутній мобільний режим |
| 12  | Гасіння стилів тоста через `bg-transparent! p-0! shadow-none!`                     | `notification-toast-item.tsx`                  | Власна композиція `Toast`                                      | `!`-важливості                              |
| 13  | Інлайн-SVG (дзвінок, ⋯, ×, ⚙, ←, око пароля, стрілки сортування)                   | 5 файлів                                       | `lucide-react` (D2)                                            | Рукописні шляхи іконок                      |
| 14  | Хаки бордерів у полі телефону: `border-e-0`, `pe-1`, `ps-1`                        | `form-phone-field.tsx`                         | `InputGroup` + `InputGroupAddon`                               | Компенсація чужого бордера                  |

Пункти 1–2 приїжджають готовими з `libs/ui`; 3–14 — робота цієї міграції.

### 3.3 Два регіони тостів — єдиний справді новий вузол

Зараз: `Toast.Provider placement="bottom end"` для помилок і другий провайдер із **власною чергою**
`notificationQueue` та render-prop, який малює `NotificationToastItem`; на `/login` — один провайдер
`placement="bottom"`.

Вендорений `ui/toast.tsx` (уже з пілота) покриває це **без нових правок реєстру**: він створює
менеджер рівня модуля і експортує `createToastManager`, `ToastProvider`, `ToastPortal`,
`ToastViewport`, `Toast`, `ToastContent`, `useToastManager`; `Toaster` приймає `toastManager` і
`position` (`top-right` додала локальна правка пілота — дзеркалення `origin`, `--offset-y`,
трансформів стеку і `swipeDirection="up"`).

```tsx
// помилки — рідний рендер реєстру
<Toaster position={isGuest ? 'bottom-center' : 'bottom-right'} />;

// сповіщення — свій менеджер, свій рендер, зсув на висоту хедера
{
  !isGuest && (
    <ToastProvider toastManager={notificationManager} limit={1}>
      <ToastPortal>
        <ToastViewport position="top-right" className="mt-14 max-w-[380px]">
          <NotificationToastList /> {/* useToastManager() → NotificationToastItem */}
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}
```

Навантаження тоста їде в `ToastObject.data` (замість `toast.content`). Обидва регіони —
незалежні провайдери, тож правило «подія і невдала дія не витісняють одна одну» зберігається дослівно.

---

## 4. Токени: не мапінг, а перехід на семантику shadcn

### 4.1 Принцип

HeroUI і shadcn описують інтерфейс **різними наборами понять**. Механічна заміна імен дає два типи
тихих регресів, і обидва вже є в нашій розмітці:

- **Клас зник** — `text-danger`, `bg-surface`, `bg-accent-soft`: утиліта не існує, Tailwind її не
  генерує, елемент лишається нефарбованим. Помітно, але не падає.
- **Клас лишився і означає інше** — `text-muted` (у shadcn `--muted` це _фон_, тож текст стає майже
  невидимим) і `*-accent` (у HeroUI бренд, у shadcn — тьмяна поверхня наведення). Це найгірший
  випадок: сторінка виглядає «майже нормально».

Тому таблиця нижче — **не** «HeroUI-ім'я → shadcn-ім'я», а «роль у застосунку → токен shadcn».
Домовляємось про ролі, далі §5 просто застосовує домовлене.

### 4.2 Семантична мапа ролей

| Роль у застосунку                            | Було (HeroUI)                                | Стає (shadcn)                                                                         | Місця                                                                                            |
| -------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Фон сторінки                                 | `bg-background`                              | `bg-background`                                                                       | `body`, `main`                                                                                   |
| Сайдбар                                      | `bg-surface`                                 | `bg-sidebar` (+`--sidebar-border/-accent`)                                            | `app-layout`                                                                                     |
| Хедер                                        | `bg-surface`                                 | `bg-background` + `border-b`                                                          | `app-layout` (у світлій темі `--card` = `--background`, тож `bg-card` не дав би контрасту)       |
| Контентна картка                             | `Card`                                       | `bg-card text-card-foreground`                                                        | dashboard, login                                                                                 |
| Спливна поверхня (попап/діалог/драйвер/тост) | `.popover`-override'и                        | `bg-popover text-popover-foreground`                                                  | dropdown, dialog, sheet, toast                                                                   |
| Поверхня наведення                           | `hover:bg-background-secondary`              | `hover:bg-accent`                                                                     | навігація, дзвінок, рядки                                                                        |
| Активний пункт навігації                     | `bg-accent-soft text-accent-soft-foreground` | `SidebarMenuButton isActive` (або `bg-accent text-accent-foreground`)                 | `app-layout`                                                                                     |
| Другорядний текст                            | `text-muted` (21 місце)                      | `text-muted-foreground`                                                               | усюди                                                                                            |
| Небезпека — текст                            | `text-danger` (10)                           | `text-destructive`                                                                    | помилки, «Log out»                                                                               |
| Небезпека — суцільна заливка                 | `bg-danger text-white` (2)                   | `bg-destructive text-white`                                                           | бейдж дзвінка (у `base-nova` **немає** `--destructive-foreground` — `text-white` тут не костиль) |
| Небезпека — мʼяка заливка                    | `Chip color="danger"`                        | `Badge variant="destructive"`                                                         | статуси                                                                                          |
| Успіх / попередження                         | `text-success`, `bg-success`                 | наше розширення `--success`/`--warning`                                               | presence, статуси; варіанти в `ui/badge.tsx`                                                     |
| Бренд                                        | `text-accent` (синій)                        | `text-primary` (монохром, W6)                                                         | назва в сайдбарі                                                                                 |
| Крапка непрочитаного                         | `bg-accent`                                  | `bg-primary`                                                                          | `notification-card`                                                                              |
| Посилання в тексті                           | `text-link`                                  | `text-primary underline underline-offset-4` (або штатний `[&>a]` в `ItemDescription`) | `notification-message`                                                                           |
| Присутність offline                          | `bg-muted`                                   | `bg-muted-foreground/40`                                                              | `presence-dot` (`bg-muted` у shadcn — світлий фон, тобто крапка стала б невидимою)               |
| Межа                                         | `border-border`                              | `border-border`                                                                       | усюди                                                                                            |
| Межа поля                                    | `--field-border` + `--field-border-width`    | `border-input` (штатна)                                                               | `ui/input`                                                                                       |
| Фокус                                        | ring 2px + `--field-border-focus`            | `ring-[3px] ring-ring/50` (штатний)                                                   | усі контроли                                                                                     |
| Обрана поверхня рядка                        | `bg-accent-soft`                             | `bg-muted`                                                                            | грід (приїде з `libs/ui`)                                                                        |

### 4.3 Поняття HeroUI, які просто зникають

`surface`, `surface-secondary`, `surface-tertiary`, `background-secondary`, `accent-soft`,
`accent-hover`, `danger-soft`/`danger-hover`, `success-soft`, `warning-soft`, `default`/`default-hover`,
`input-group-bg*`, **усі `--field-*`**, `--border-width-field`, `--overlay-shadow`, `swatch-current`,
`area-*`. Відповідників не шукаємо — їх немає, бо shadcn описує ті самі речі станами компонента,
а не окремими токенами.

Разом із ними зникають **усі CSS-override'и** з `apps/web/src/index.css` (~70 рядків):

| Блок                                                                  | Навіщо був                         | Чому не потрібен                                  |
| --------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------- |
| `:root { --field-radius/--field-border/--field-shadow }`              | Видима рамка й радіус полів        | У shadcn поле має рамку `border-input` штатно     |
| `.checkbox { … }` + `[data-theme='dark'] .checkbox`                   | Скасувати рамку полів для чекбокса | Чекбокс shadcn не споживає токени полів           |
| `.card/.modal__dialog/.alert-dialog__dialog`                          | Радіус 12px                        | `--radius` + множники пресета                     |
| `.popover/.dropdown__popover/.select__popover/.autocomplete__popover` | Радіус і 1px-обвід у світлій темі  | Штатні `ring-1`/`border` попапів                  |
| `.menu-item/.list-box-item`                                           | Радіус пунктів                     | Штатний                                           |
| `.table-root--primary`                                                | Звузити `--radius-2xl` локально    | Наш грід не використовує компонент-таблицю HeroUI |
| Селектори `[data-theme='light'/'dark']`                               | Тема HeroUI                        | Тема — лише `.dark` (`@custom-variant dark`)      |

**Рішення «менша округлість» переживає міграцію**, але вже не як override'и: `--radius: 0.5rem` у
темі, звідки пресет рахує `sm .6 / md .8 / lg 1 / xl 1.4 / 2xl 1.8` — тобто ≈5/6/8/11/14px. Це
рішення користувача про вигляд, а не спадок HeroUI.

### 4.4 Де живе тема

Після UI-0 — **один файл**: `libs/ui/src/styles.css` (`@import 'tailwindcss'` + `tw-animate-css` +
`shadcn/tailwind.css` + шрифт, `@custom-variant dark`, `:root`/`.dark`, `@theme inline`, `@layer base`).
`index.css` кожного застосунку зводиться до імпорту пакета плюс `@source` на власний `src`
(Tailwind 4 має бачити класи обох дерев — і застосунку, і пакета).

### 4.5 Як перевіряти, що свіп повний

Прийом пілота (§5.3 `docs/migrate.md`), він себе виправдав: усі `--color-*` із `@heroui/styles/dist`
**мінус** токени нашої теми = список мертвих імен, далі grep розмітки з префіксами
`bg|text|border|ring|outline|divide|fill|stroke|shadow|from|to|via`. Плюс окремо — два «тихі»
випадки з §4.1: `text-muted\b` і `*-accent\b` (вони grep-ом «мертвих» не ловляться).

Порахований стан на сьогодні: `text-muted` 21, `text-danger` 10, `bg-surface` 6,
`bg-background-secondary` 3, `bg-danger` 2, `text-accent`/`bg-accent` по 2, `border-accent` 1,
`accent-soft` 1, `text-link` 1, `text-white` (поверх danger) 2.

---

## 5. Порядок виконання

### 5.A UI-0 — витягнути `libs/ui` (споживач: `platform-web`)

Ціль фази: `apps/platform-web` працює точно так само, як після пілота, але його UI-код живе в пакеті.
Жодного нового компонента, жодної зміни вигляду — тільки переїзд.

1. **Каркас пакета.** `libs/ui/package.json` (`private`, `@saas-skeleton/ui`) з `exports`-мапою —
   без неї Vite/Rollup не резолвить субпаті (грабля MT-3 із `contracts`; tsconfig `paths` тут не
   рятує):
   ```jsonc
   "exports": {
     "./styles.css": "./src/styles.css",
     "./lib/*": "./src/lib/*.ts",
     "./components/*": "./src/components/*.tsx",
     "./hooks/*": "./src/hooks/*.ts"
   }
   ```
   Плюс рядок у `tsconfig.base.json` `paths` (для api/worker-подібних споживачів його не треба, але
   для однорідності — як у решти ліб) і власний `tsconfig.json` із `typecheck`.
2. **Переїзд файлів** із `apps/platform-web/src`: `components/ui/**` → `libs/ui/src/components/ui/`,
   `lib/utils.ts`, `lib/page-items.ts` → `libs/ui/src/lib/`, `components/data-grid/**` →
   `libs/ui/src/components/data-grid/`, `components/form/**` → `libs/ui/src/components/form/`,
   `components/theme-switcher.tsx`, блок теми з `index.css` → `libs/ui/src/styles.css`.
3. **`components.json`**: у пакеті — свій (шлях до `styles.css`, `aliases.ui` на власні теки), у
   застосунку — `aliases.ui`/`components`/`lib`/`hooks` вказують на `@saas-skeleton/ui/...`. Це
   документований монорепо-режим CLI: `shadcn add` кластиме нові примітиви в пакет і сам перепише
   імпорти. Перевірити на одному компоненті (`npx shadcn@latest add tooltip --dry-run`).
4. **Розвʼязати `error-toast.ts`.** Він єдиний зі спільних файлів тягне `i18n` застосунку. Варіанти:
   (а) лишити його в кожному застосунку (він і так короткий); (б) винести в пакет, приймаючи
   `t`-функцію параметром. Рекомендація — **(а)**: пакет не має знати про i18n-неймспейси застосунків.
5. **Tailwind:** у `index.css` кожного застосунку `@import '@saas-skeleton/ui/styles.css'` +
   `@source '../../../libs/ui/src'`. Перевірити, що класи з пакета доїжджають у зібраний CSS
   (як у пілоті — probe-файлом і grep-ом по бандлу).
6. **ESLint:** блок-override на `libs/ui/src/components/ui/**` (замість шляху platform-web).
7. **Приймання UI-0:** `typecheck` + `lint` + `build`, і **повторити ручні критерії §7 пілота**
   на `platform-web` — це і є baseline, заради якого фаза йде першою.

### 5.B UI-1 — міграція `apps/web`

**5.B.0 Передумови.** `apps/web/tsconfig.json`: `baseUrl: "."` + `paths: { "@/*": ["src/*"] }`
(успадковані `paths` **заміщуються** — `@saas-skeleton/*` піде через симлінки, як у пілоті);
`vite.config.ts`: `resolve.alias['@']`. Наявні `server.proxy` (`/api`, `/socket.io` з `ws: true`)
не чіпати. Перевірити `typecheck`+`build` до будь-яких змін коду.

**5.B.1 Підключення пакета і теми.** `package.json`: `@saas-skeleton/ui": "workspace:*"`;
`index.css` → імпорт теми пакета + `@source`; HeroUI-override'и видалити, `@import '@heroui/styles'`
**лишити до 5.B.7**; `main.tsx` → `attribute="class"`; `components.json` застосунку (аліаси на пакет).

**5.B.2 Нові примітиви в пакет.** Те, чого пілоту не було потрібно:

```bash
npx shadcn@latest add sheet switch progress combobox item toggle-group tooltip scroll-area \
  skeleton sidebar
# sidebar тягне за собою sheet/skeleton/tooltip/separator/input/use-mobile (W9)
```

Кластися має **в `libs/ui`** (перевірити `--dry-run`). Після `add` — prettier і `lint`.

**5.B.3 Свіп токенів** за §4.2 — одним заходом, до переписування компонентів; перевірити по §4.5.

**5.B.4 Переключити спільне на пакет.** Видалити `apps/web/src/components/{data-grid,form}/**` і
`theme-switcher.tsx`, замінивши імпортами з `@saas-skeleton/ui`. Точкові відмінності:
`FormPhoneField` лишається локальним (W2) і імпортує `Field`/`InputGroup` з пакета; `form-select`
пишеться в пакеті (його там ще немає); `data-grid/index.ts` більше не експортує `CellSwitch`.

**5.B.5 Компоненти — файл за файлом** (typecheck після кожного), від листя до кореня:

1. `form/form-select.tsx` (у пакеті) → `form-phone-field.tsx` → `phone/country-select.tsx` (W5, костиль 4);
2. `user-identity.tsx` (костиль 7) → `presence-dot.tsx` (костиль 8) → `file-dropzone.tsx` (костиль 5);
3. модалки: `change-password-modal` → `create-user-modal` → `change-avatar-modal` (`Progress`);
4. `activity/activity-drawer.tsx` — перший `Sheet` + `Empty` (костиль 9), на ньому відпрацьовується патерн;
5. інбокс: `notification-card` (костилі 6, 13) → `notification-item` → `notification-preferences`
   (костиль 3) → `notification-panel` (костилі 9, 10) → `notification-bell` (костиль 13);
6. тости: `realtime/notification-toast.ts` → `notification-toast-item.tsx` (костиль 12) → `toast-host.tsx`;
7. `app-layout.tsx` (костиль 11) → `pages/login.tsx` → `pages/dashboard.tsx` → `pages/users.tsx`;
8. видалити `data-grid/cell-switch.tsx` (костиль 3).

**5.B.6 Вирівняти `platform-web`.** Те, що прийнято в W9/W10, застосувати і там — інакше «одна
платформа в одному стилі» не виконана: `app-layout.tsx` на `Sidebar*`, порожні стани на `Empty`,
рядок оператора на `Item`. Обсяг малий (один-два файли), але робити його треба **в цій же гілці**.

**5.B.7 Прибирання.** `@heroui/*` з `package.json`; `@import '@heroui/styles'` з `index.css`;
`pnpm install` → у локі **жодного імпортера** HeroUI; тулінг і документи за W7; зміряти бандл
до/після (у пілоті CSS −81%, JS −13%).

**5.B.8 Приймання** — §7.

---

## 6. Що не можна ламати

- **Публічний API гріда.** `createDataGrid<TFilters, TItem>()` і компаунд-набір
  `Root/Filters/Table/SelectionSummary/filter`. `pages/users.tsx` не має змінитися ніде, крім
  `Chip`, `toast` і `CellSwitch`. Окремо: `selection` + `SelectionSummary` у `platform-web` лежать
  **неспожитими** (жоден `Grid.Root` там не вмикає `selection`; на прийманні пілота його вмикали
  тимчасово й відкотили) — `apps/web` буде першим реальним споживачем.
- **Контракти форм**: `FormTextField`/`FormPasswordField`/`FormSelect`/`FormPhoneField` — ті самі
  пропси; `applyServerError` і `errors.root.server` працюють як раніше (форми мусять мати повні
  `defaultValues`).
- **Поза міграцією**: `api/api-error.ts`, `api/http-client.ts`, `stores/**`, `realtime/**` (крім
  черги в `notification-toast.ts`), `lib/init-auth.ts`, `router.tsx`, `i18n/**`, `api/generated/**`.
  `showNotificationToast`/`clearNotificationToasts` зберігають сигнатури — їх кличе код поза React.
- **`error-toast.ts` працює поза React-деревом** — менеджер тостів лишається модульним синглтоном.
- **Одна картка для тоста і для центру** (`NotificationCard`); `role`-кнопка (тепер справжня
  кнопка через `Item render`) — лише в `plain`-режимі, бо в центрі всередині є лінк на сутність.
- **Ключі i18n** не перейменовуються. Нові — тільки якщо зникає текст, який давала бібліотека.
- **Presence**: при `isUnknown` індикатор не рендериться взагалі; перехід на `AvatarBadge` цього
  не змінює.

---

## 7. Критерії приймання

Автоматичні:

- `pnpm typecheck` (усі таргети, включно з новим `@saas-skeleton/ui`), `pnpm build`,
  `pnpm lint --max-warnings 0`;
- `grep -rn "@heroui" apps libs` — порожньо; `@heroui/*` немає в жодному `package.json` і в
  `pnpm-lock.yaml` **жодного імпортера**;
- мертві токени (§4.3) — 0 збігів; окремо `text-muted\b` — 0, `-accent\b` — лише там, де це
  свідома поверхня наведення (§4.2);
- костилі: `grep -rn "createPortal\|SelectionCheckbox\|inert\|measureAnchor\|--trigger-width" apps libs`
  — порожньо; `role="button"` — порожньо; сирі `<button`/`<input` — лише всередині
  `libs/ui/src/components/ui/**` і в `file-dropzone.tsx` (прихований file-input);
- `!`-важливості в розмітці тостів — порожньо;
- обидва застосунки не мають власних `components/ui/**` (усе в пакеті).

Ручні (`pnpm web:dev` :5173, `admin@example.com`/`Admin12345`; потрібні docker + api + worker;
плюс перепрогін пілотного §7 на `platform-web` — він тепер теж на пакеті):

- тема світла/темна/системна; на `<html>` лише `class`;
- `/login`: zod-валідація, серверна помилка у формі, перемикач пароля, toast знизу по центру;
- `/users` грід: сортування (`aria-sort`), пагінація, `items per page`, фільтри в URL,
  **вибір рядків** (рядок, шапка, indeterminate, `Space`, Clear, накопичення між сторінками);
- `/users` рядкові дії: зміна пароля; enable/disable (з `AlertDialog` і тостом помилки);
  View activity (`Sheet` + Load more + порожній стан); Change avatar (dropzone → `Progress` →
  аватар оновився; **дропзона керується з клавіатури**); Delete з підтвердженням;
- телефонне поле: пошук країни, порожній результат, клавіатура, попап **завширшки з поле і
  вирівняний по ньому**, форматування при вводі, вставка міжнародного номера, підказка про довжину;
- інбокс: бейдж на дзвінку; живий тост (створити юзера → welcome із воркера) зверху праворуч під
  хедером; попередній тост закривається явно; при відкритій панелі тост не показується; клік по
  тосту відкриває центр; × у тості ховає, ⋯ у центрі архівує; фільтри `ToggleGroup` (`aria-pressed`);
  преференси з тумблерами (у т.ч. `muteable: false` без тумблера); синхронізація між вкладками;
- присутність: `AvatarBadge` online/offline + тултіп; при вимкненому API бейдж зникає, тост
  **не** зʼявляється (`meta.silentError`);
- помилки: вимкнути api → toast **знизу праворуч**, не витісняючи регіон сповіщень;
- сайдбар: згортання, мобільний режим (вузьке вікно → `sheet`), активний пункт, `SidebarTrigger`
  з клавіатури — перевірити в **обох** застосунках;
- дропдауни/діалоги/драйвери: Tab/Escape/стрілки, фокус повертається на тригер;
- консоль без помилок на всіх сторінках.

Свідомо прийняті розбіжності зафіксувати списком (очікувані: монохромний бренд замість синього,
дрібніша типографіка `Badge`, focus-ring 3px, підпис поля червоніє разом із помилкою, шрифт Geist,
англійське «Close» у вендорених діалогах).

---

## 8. Формат роботи

Строго §5.A → §5.B, файл за файлом у 5.B.5. Після кожного файлу — `typecheck`; червоний тайпчек не
переносити на наступний файл. Кожне відхилення від плану — рядок у §9 із причиною. Ручну частину §7
перевіряти вимірюванням у DOM (headless-браузер), а не скріншотом.

Коміти: (1) UI-0 — витягування пакета; (2) тулінг і конфіг web; (3) міграція `apps/web`;
(4) вирівнювання `platform-web`; (5) документи.

---

## 9. Журнал виконання

### ✅ UI-0. Спільний пакет `libs/ui` (2026-08-24)

Ціль фази — переїзд без жодної зміни вигляду; споживач на цьому кроці один, `apps/platform-web`.

**Що переїхало** (38 файлів, `git mv` — історія збережена): `components/ui/**` (20 примітивів),
`components/data-grid/**` (9), `components/form/**` (4), `theme-switcher.tsx`, `lib/utils.ts`,
`lib/page-items.ts`, блок теми з `index.css` → `libs/ui/src/styles.css`.

**Пакет.** `@saas-skeleton/ui`, source-only (як `libs/i18n`/`libs/contracts`), `exports`-мапа —
`./styles.css`, `./lib/*`, `./api/*`, `./components/ui/*`, `./components/data-grid`,
`./components/form`, `./components/theme-switcher`. Імпорти всередині пакета переписані з
аліаса застосунку `@/…` на **самопосилання** `@saas-skeleton/ui/…` (документована монорепо-форма
shadcn: `aliases.ui` у `components.json` вказує на workspace-пакет). Працює і в TS
(`moduleResolution: bundler` читає `exports`), і у Vite; окремих `paths` у застосунку не треба.

**Правки плану, зроблені на місці:**

1. **`api/api-error.ts` теж переїхав у пакет** — план (§6) велів його не чіпати, але
   `form/server-error.ts` (частина контракту форм, який ми виносимо) імпортує з нього
   `parseApiError`/`isGlobalApiError`. Лишити його в застосунку означало б розірвати контракт форм
   між двома домівками. Файл і так був побайтово однаковий у двох фронтах.
2. **Розвʼязка з i18n застосунку.** `api-error.ts` і `server-error.ts` імпортували `../i18n`
   (модуль застосунку). Замінено на `import i18n from 'i18next'` — це **той самий** дефолтний
   синглтон, який піднімає `src/i18n` кожного фронту (`i18n.use(initReactI18next).init(…)`), тож
   пакет більше не знає про неймспейси застосунку, а ключі `errors:*` і так приходять зі спільного
   `libs/i18n`. Це дозволило лишити `error-toast.ts` у застосунку, як і планувалось (варіант «а»).
3. **`@/*` у `platform-web` лишився**, хоча жоден файл застосунку його вже не використовує:
   видалення нічого не дає, а `apps/web` свій аліас усе одно матиме.

**Грабля, якої в плані не було: бекенди підбирали фронтовий пакет у свою TS-програму.**
`apps/{api,platform-api,worker}/tsconfig*.json` мали `include: ["src/**/*", "../../libs/*/src/**/*"]` —
**wildcard по всіх лібах**. Щойн зʼявився `libs/ui`, webpack-збірка platform-api впала з
**353 помилками** `TS17004: Cannot use JSX unless the '--jsx' flag is provided`. Виправлено в
8 файлах: замість wildcard — явний перелік того, що бекенди справді споживають
(`contracts`, `database`, `shared`). Окремо повчальне: `pnpm typecheck` цього **не зловив** — turbo
віддав закешований результат, бо додавання нової ліби не інвалідує таск `apps/api`. Тому перевірку
довелося ганяти з `--force`, і це тепер частина приймання фази.

**ESLint.** Блок «React-код: явні типи повернення — зайвий шум» покривав лише `apps/*-web/**`;
після переїзду 252 помилки. Додано `libs/ui/src/**` у той самий блок; блок для вендореного
`ui/**` перенаправлено з `apps/platform-web/src/components/ui/**` на `libs/ui/src/components/ui/**`.

**Доказ того, що переїзд нічого не змінив:** прод-збірка `platform-web` дала CSS із **тим самим
хешем і розміром**, що до переїзду — `dist/assets/index-RkXHzjbj.css`, 77.51 kB (JS-хеш очікувано
інший — змінилися шляхи модулів, але розмір збігся до байта: 937.14 kB).

**Перевірки:** `pnpm typecheck --force` (9/9, з новим таргетом `@saas-skeleton/ui`),
`pnpm lint --max-warnings 0`, `pnpm build --force` (5/5), prettier по зачепленому чистий
(лишився один давно брудний `apps/platform-web/src/i18n/index.ts`).

**Живий прогін** (docker + platform-api :3002 + platform-web :5174, вимірювання в DOM):

| Критерій                | Результат                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Логін оператором        | ✅ `/` зі списком тенантів із БД (2 рядки)                                                                                                                 |
| Тема                    | ✅ `class="dark"` → `class="light"`, `data-theme` немає; фокус повертається на тригер                                                                      |
| Діалог `New tenant`     | ✅ `DialogTitle` на місці, порожній сабміт → 4 `[data-invalid=true]` і 4 `aria-invalid`, Cancel закриває                                                   |
| `AlertDialog` (Suspend) | ✅ заголовок, `AlertDialogMedia` з іконкою, кнопки Cancel/Suspend                                                                                          |
| Грід `/jobs`            | ✅ 8 колонок, `aria-sort` перемикається, URL `?sortOrder=asc&sortBy=name`, фільтри queue/state, пагінація                                                  |
| Тост поза React-деревом | ✅ 500 → «Server error», 503 → «Service unavailable», 403 → «Access denied»; на `/login` регіон **знизу по центру**: centerX 720/1440, нижній відступ 16px |
| Консоль                 | ✅ без помилок (крім навмисно змодельованого 500 при зупиненому API)                                                                                       |

Спостереження для наступних прогонів: у вкладці з нульовим viewport (`0x0`) вимірювати позицію
тостів **не можна** — трансформи стеку рахуються від висоти вікна, і всі значення виходять
відʼємними. Спершу `resize_window`, потім вимір.

### ✅ UI-1. Міграція `apps/web` (2026-08-24)

**Обсяг:** 29 файлів із HeroUI → 0. З них 9 замінено імпортом із `libs/ui` (файли видалені),
20 переписано, `cell-switch.tsx` видалений разом із костилем, `form-select.tsx` написаний наново
в пакеті. Плюс до пакета доданo 11 нових примітивів (`sheet switch progress combobox item
toggle-group tooltip scroll-area skeleton sidebar` + `toggle`, `hooks/use-mobile`).

**Костилі, зняті цим ходом** (реєстр §3.2):

| #   | Було                                                                     | Стало                       | Доказ                                                                 |
| --- | ------------------------------------------------------------------------ | --------------------------- | --------------------------------------------------------------------- |
| 1–2 | `SelectionCheckbox` (`inert` + нативний input), `createPortal` у `thead` | штатний `Checkbox`          | приїхало з `libs/ui`                                                  |
| 3   | `CellSwitch` (`inert` + `input[role=switch]`)                            | `Switch`                    | тумблер у преференсах перемикається з першого кліку (true→false→true) |
| 4   | `measureAnchor`, `crossOffset`, `--trigger-width`                        | `ComboboxContent anchor`    | попап країн: ширина 388 = ширина поля 388, `leftDiff` 0               |
| 5   | `role="button"`+`tabIndex`+`onKeyDown` на `<div>` дропзони               | `Empty` + справжня `Button` | —                                                                     |
| 6   | те саме в картці сповіщення                                              | `Item render={<button/>}`   | картка тоста — `BUTTON`, вкладених кнопок 0                           |
| 7   | ручний медіа-обʼєкт (`min-w-0`/`truncate`/`title`)                       | `Item*`                     | —                                                                     |
| 8   | абсолютний `<span>` + `title` для presence                               | `AvatarBadge` + `Tooltip`   | 8×8, `bg-success`, `aria-label="Online"`                              |
| 9   | порожні стани як `<p class="py-8 text-center">`                          | `Empty*`                    | —                                                                     |
| 10  | три `Button` із ручним `variant`                                         | `ToggleGroup`               | `aria-pressed` на активному фільтрі                                   |
| 11  | рукописний `<aside class="w-60">`                                        | `Sidebar*`                  | згортання `expanded↔collapsed`, стан у cookie                         |
| 12  | `bg-transparent! p-0! shadow-none!` на тості                             | власна композиція `Toast`   | `!` у розмітці 0                                                      |
| 13  | інлайн-SVG у 5 файлах                                                    | `lucide-react`              | —                                                                     |
| 14  | `border-e-0`/`pe-1`/`ps-1` у полі телефону                               | `InputGroupAddon`           | —                                                                     |

**Правки плану, зроблені на місці:**

1. **Порядок 5.B.3 і 5.B.4 помінявся:** свіп токенів робився ПІСЛЯ переключення на пакет — інакше
   довелося б чистити 9 файлів, які за годину видаляються.
2. **`FormSelect` потребує `items`.** Без цієї мапи Base UI малює в тригері СИРЕ значення (`USER`),
   а не підпис (`User`): підпис він не читає з `children` елемента списку. Знайдено живим прогоном.
3. **Два випадки невалідного HTML, породжені самою міграцією** (React пише їх у консоль):
   `<p>` у `<p>` — `AlertDialogDescription` уже є абзацом, тож `body` рядкової дії в `users.tsx`
   більше не обгортає `<Trans>` у власний `<p>`; `<button>` у `<button>` — картка сповіщення в
   `plain`-режимі сама є кнопкою, тож хрестик і меню винесені в обгортку ПОРУЧ із `Item`.
4. **ESLint:** вендорені `sidebar`/`toggle-group`/`use-mobile` додали ще 4 правила апстріму
   (`consistent-type-definitions`, `restrict-template-expressions`, `no-confusing-void-expression`,
   `prefer-nullish-coalescing`) — вимкнені в тому ж блоці, `hooks/**` додані до його `files`.
5. **5.B.6 виконано:** `platform-web` переведений на той самий `Sidebar` — інакше «одна платформа
   в одному стилі» не виконувалась би.

**Бандл `apps/web`:** CSS 307.4 KB, з них **189.9 KB (61%) — це `country-flag-icons`**
(257 прапорів inline-SVG, до міграції не стосується); власне UI-шар — 117.5 KB проти 77.5 KB у
`platform-web`, різниця очікувана: сайдбар, sheet, combobox, item, toggle-group, tooltip,
scroll-area, progress, switch. JS 1150.9 KB.

**Живий прогін** (docker + api :3001 + worker + web :5173, вимірювання в DOM):

| Критерій                   | Результат                                                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`                   | ✅ порожній сабміт → 2 `data-invalid` + 2 `aria-invalid`; перемикач пароля `password→text`, `aria-label` Show→Hide                                                                                                          |
| Каркас                     | ✅ `Sidebar` з іконками, активний пункт `data-active`, `SidebarTrigger` згортає (`expanded↔collapsed`, стан у cookie)                                                                                                       |
| Грід `/users`              | ✅ 20 рядків, сортування (`aria-sort` + `?sortBy=role&sortOrder=asc`), пошук (`?search=`), пагінація (`?page=2`), `items per page` (`?limit=10` → 10 рядків)                                                                |
| **Вибір рядків**           | ✅ рядок → `aria-checked=true` + «1 selected», шапка → `mixed`, клік по шапці → 20, Clear скидає                                                                                                                            |
| Рядкові дії                | ✅ 5 пунктів; `Change password` і `View activity` відкривають Dialog/Sheet; `Disable access` → `AlertDialog` із `AlertDialogMedia`, `<strong>` у тексті і кнопками Cancel/Disable                                           |
| Присутність                | ✅ `AvatarBadge` 8×8 `bg-success`, `aria-label="Online"`, `role="img"`; API-снапшот збігається                                                                                                                              |
| Телефонне поле             | ✅ попап країни = ширина поля (388/388, зсув 0), пошук «germ» → 1 елемент, «zzzzzz» → `ComboboxEmpty` видимий, вибір міняє тригер на `+49`; форматування при вводі, вставка `+380671234567` → `67 123 4567` і країна `+380` |
| `FormSelect`               | ✅ тригер показує `User`, а не `USER` (після правки §2)                                                                                                                                                                     |
| **Живі сповіщення**        | ✅ інший адмін створює юзера → тост зверху праворуч (top 72 = 16 + висота хедера, ширина 380) із текстом «… added user Live Toast», бейдж дзвінка «1»; повторна подія показала колапс («added 2 users, la…»)                |
| Центр сповіщень            | ✅ `Sheet`, `ToggleGroup` (Unread/All/Archived, `aria-pressed` на All), 13 карток, футер «Mark all as read»                                                                                                                 |
| Преференси                 | ✅ 2 тумблери (`user.created`, `user.welcome`) + 1 «Always» (немутабельний тип), перемикання зберігається                                                                                                                   |
| Тости помилок              | ✅ окремий регіон **знизу праворуч** (`bottomGap` 16), регіон сповіщень — зверху (`top` 72); обидва viewport-и співіснують                                                                                                  |
| Тема                       | ✅ `class="light"`, `data-theme` немає                                                                                                                                                                                      |
| `platform-web` після 5.B.6 | ✅ той самий `Sidebar` («Tenants*», «Jobs»), список тенантів на місці                                                                                                                                                       |

**Дві граблі перевірки, які варто знати наперед** (додаток до нотатки UI-0 про viewport `0×0`):

- **У прихованій вкладці не програються CSS-анімації.** Base UI знімає попап із DOM після
  `animationend`, тож закритий `AlertDialog` лишався у дереві з `data-closed` + `data-ending-style`.
  Це виглядало як «Cancel не працює», хоча стан перемикався коректно (повторне відкриття міняло
  `data-closed` → `data-open` на ТОМУ САМОМУ елементі, `getAnimations()` = 0). Судити треба за
  `data-open`/`data-closed`, а не за наявністю вузла.
- **Буфер `read_console_messages` кумулятивний** — `console.clear()` і перезавантаження його не
  чистять, тож «чистоту консолі після правки» довелося доводити структурою DOM
  (`alert-dialog-description` містить лише `<strong>`; у картці тоста 0 вкладених кнопок).

Ще одна дрібниця: на початку прогону здавалось, що підтвердження рядкової дії взагалі не
відкривається. Причина — застарілий модульний граф dev-сервера, піднятого посеред міграції;
після рестарту все працює, а окремий тест довів, що HMR зміни в `libs/ui` підхоплює (правка
`console.log` → нове значення без рестарту).

### ✅ UI-2. Вирівнювання теми під HeroUI (2026-08-24)

Після UI-1 обидва фронти виглядали як стоковий `base-nova` (монохром, білий фон, Geist).
Завдання від користувача — повернути «мʼякий» вигляд HeroUI: шрифт, сірі відтінки текстів,
сині Primary-кнопки-пігулки, суцільний danger, синій фокус у полях (але **з рамкою**, якої в
HeroUI немає і яка там читалась гірше).

**Готового рішення не знайшлось** і його не існує: теми реєстру `@shadcn`
(`theme-zinc/slate/gray/stone/neutral`) — це лише заміна відтінку сірого, і для стилю
`base-nova` вони навіть **не опубліковані** (`view @shadcn/theme-slate` → 404); іменовані
пресети (`nova`, `vega`, `maia`, `lyra`, `mira`, `luma`) — варіації того самого нейтралу.
Тому токени прокладені вручну — і це виявилось дешево, бо обидві системи побудовані однаково
(семантичні змінні в `oklch` + міст `@theme inline` у Tailwind 4), а тема після UI-0 — один файл.

**Джерело значень** — дефолтна тема `@heroui/styles`, витягнута їхнім MCP
(`get_theme_variables`), плюс `button.css`/`input.css` і файл утиліт із CDN пакета.

**Що з'ясувалося про шрифт.** `@heroui/styles` **не задає** `font-family` взагалі
(перевірено `dist/base/base.css`) — тобто `apps/web` весь час рендерився системним стеком, а
Geist приїхав із пресетом `base-nova`. Власний сайт і документація HeroUI набрані **Inter**
(у розмітці `heroui.com` клас `inter_5901b7c6-module__…__variable`, тобто `next/font`). Взяли
Inter: `@fontsource-variable/inter` замість `@fontsource-variable/geist`.

**Три речі, які й дають «мʼякість»** (колір — лише третя):

1. **Фон сторінки сірий, панелі білі.** У HeroUI `--background: oklch(0.9702 0 0)`, а
   `--surface`/`--overlay` — чистий білий. У `base-nova` `--card` дорівнював `--background`
   (обидва білі), через що інтерфейс читався пласким.
2. **Багатошарові мʼякі тіні** замість хейрлайнів. Реалізовано **без правок компонентів**:
   `--shadow-xs/sm/md/lg/xl` у `@theme inline` тепер посилаються на тема-залежні
   `--elevation-*` із `:root`/`.dark`, тож `shadow-md`/`shadow-lg`, які вже стоять у
   вендореному коді, малюють шари HeroUI, а в темній темі — нічого (там глибину дає різниця
   світлості поверхонь, як у них).
3. **Нейтралі з фіолетовим підтоном** (hue ≈ 286) і сірий тексту `oklch(0.5517 0.0138 285.94)`
   — саме та спокійна шкала, яку користувач і просив узяти як є.

**Мапа ролей** (HeroUI → shadcn): `background`→`background`, `surface`→`card`+`sidebar`,
`overlay`→`popover`, `muted`→`muted-foreground`, `default`→`muted`+`secondary`,
`surface-hover`→`accent` (через `color-mix`, як у них), `accent` (бренд)→`primary`,
`focus`→`ring`, `danger`→`destructive`, `success`/`warning`→наше розширення.

**Правки вендореного коду (позначені коментарем «ЛОКАЛЬНА ПРАВКА реєстру»), +4 до наявних двох:**

| Файл                                                                     | Що і чому                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ui/button.tsx`                                                          | `rounded-full` (у HeroUI кнопка — `rounded-3xl` при висоті 40px, тобто пігулка); `destructive` — **суцільний** червоний із білим текстом (`.button--danger`), а не мʼяка заливка; натиск — `scale(0.97)`, як у них; hover рахується `color-mix` із foreground, а не прозорістю (на сірому фоні прозорість вимиває колір) |
| `ui/input.tsx`, `ui/textarea.tsx`, `ui/select.tsx`, `ui/input-group.tsx` | поле отримало власну **білу** поверхню `bg-card` + `shadow-xs` (`--field-background` + `--field-shadow` у HeroUI): стокове `bg-transparent` на сірій сторінці показувало сірий фон і поле губилось. Рамку лишили видимою — свідоме відхилення від HeroUI на прохання користувача                                         |

**Наші компоненти, які довелось перепризначити** під розділення «фон / поверхня»: хедер у
обох `app-layout` (`bg-background` → `bg-card`), контейнер таблиці гріда (`+bg-card shadow-sm`),
круглі кнопки картки сповіщення (`bg-background` → `bg-popover`).

**Що переглянуто:** рішення **W6** (монохромний бренд) скасовано — повернувся синій акцент
`oklch(0.6204 0.195 253.83)` і **синє фокус-кільце** (`--ring: var(--primary)`, бо в HeroUI
`--focus: var(--accent)`).

**Друга ітерація (того ж дня, за зауваженнями користувача):**

- **Фокус-кільце тепер точно як у HeroUI** — суцільні `ring-2` замість напівпрозорих
  `ring-[3px] ring-ring/50`, у 14 файлах реєстру. Кнопки додатково отримали `ring-offset-2`
  кольору фону (їхній `focus-ring`), поля лишились без відступу (їхній `focus-field-ring`).
  Виміряно в браузері: поле — `oklch(0.6204 …) 0 0 0 2px`; кнопка — шар фону `0 0 0 2px`
  плюс синій `0 0 0 4px`, тобто 2px кільця за 2px проміжком. Невалідний стан підтягнутий до
  тієї ж геометрії (`ring-2 ring-destructive/60`).
- **Висоти підняті на крок і зведені з кнопками.** Еталон — десктопна шкала HeroUI
  (`button` = `md:h-9` = 36px): `default` кнопка і ВСІ поля (`input`, `input-group`,
  `select`) тепер 36px, `sm` — 32px, `xs` — 28px, `lg` — 40px; іконкові кнопки
  `size-7/8/9/10`. Горизонтальні відступи полів — `px-3`, як у їхнього `.input`.
  `FormSelect` більше не нав'язує `h-9` класом — висота стала дефолтною.

**Третя ітерація — блок ідентичності в таблиці:** аватар піднятий до стандарту реєстру
(`Avatar` default = 32px замість 24px `sm`; `Item size="sm"`), між іменем і поштою прибрано
повітря (`leading-tight` на обох рядках замість стокових `snug`/`normal`, `gap-0`), аватар
вирівняний по центру блоку (стоковий `ItemMedia` притискає медіа до верху зі зсувом 2px —
це розраховано на багаторядковий опис, а тут рядків рівно два). Індикатор присутності
тепер малюється **тільки для online**; разом із цим контракт `PresenceDot` звузився з
`labels: {online, offline}` до `label`, а ключ `users:presence.offline` видалений як мертвий.

**Свідомі відмінності від HeroUI, які лишаються:**

- **рамка полів видима** (у них `--field-border: transparent`) — на прохання користувача;
- радіуси панелей і полів лишились 11/8px (рішення користувача ще з HeroUI-ери), кнопки —
  пігулки.

**Перевірено наживо** (обидва фронти, обидві теми): токени доїжджають
(`--background oklch(0.9702 0 0)`, `--primary oklch(0.6204 0.195 253.83)`, `--ring` = primary),
шрифт `"Inter Variable"`; поле має білу поверхню і тінь `0 2px 4px/.04 + 0 1px 2px/.06 + 0 0 1px/.06`;
Tab по полю дає **синє** кільце і синю рамку; кнопка підтвердження видалення — суцільна червона
пігулка з білим текстом; у темній темі поверхні світліші за фон, тіней немає.

**Бандл:** `platform-web` CSS 77.5 → 114.0 KB (нові примітиви з UI-1 тепер сканує обидва
застосунки + шари тіней), `apps/web` 307.4 → 316.8 KB. Geist зник із лок-файла, натомість Inter.

### ✅ UI-3. Розкладка шела за патерном `sidebar-07` (2026-08-24)

Привід — блок **App Shell 1** у галереї ReUI (бренд угорі сайдбара, профіль юзера у футері).

**Розбір ReUI (рішення D3 не переглянуто — залежністю не беремо):**

- реєстр `@reui` = `https://reui.io/r/{style}/{name}.json`, вони справді публікують під
  `base-nova` і заявляють сумісність із Base UI, тож наш рядок у `components.json` коректний;
- публічний індекс `https://reui.io/r/base-nova/registry.json` — **1668 позицій**
  (1591 блок, 73 ui, 4 хуки), із них **1072 вільні `c-*`**;
- але вільні `c-*` — це **приклади використання**, а не бібліотека: `c-avatar-1` це
  `export function Pattern()` із нашим же `Avatar` і `registryDependencies: ["avatar"]`;
- усе цінне (`app-shell-*`, `button-1`, іконки, шаблони) віддає **401**
  `Authentication required … Bearer YOUR_LICENSE_KEY` — платна ліцензія.

**Потрібний патерн виявився безкоштовним у самого shadcn:** блок `sidebar-07`
(`https://ui.shadcn.com/r/styles/base-nova/sidebar-07.json`, HTTP 200) містить `TeamSwitcher`
(плитка логотипа + назва + підзаголовок у `SidebarHeader`) і `NavUser` (аватар + імʼя + пошта

- дропдаун у `SidebarFooter`), обидва як `SidebarMenuButton size="lg"` і на наших же
  компонентах (`sidebar`, `avatar`, `dropdown-menu`) з Base UI `render`. Реалізували самі за цим
  зразком — нових залежностей нуль.

**Зроблено в обох застосунках:**

- `SidebarHeader` — квадратна плитка `bg-sidebar-primary` з іконкою (`Layers` / `ShieldCheck`),
  назва продукту і підзаголовок (`layout.brandSubtitle`: «Workspace» / «Control plane»).
  Підзаголовок — заготовлене місце під назву тенанта, коли вона доїде на фронт (MT-4);
- `SidebarFooter` — `UserIdentity` + `ChevronsUpDown` у `DropdownMenuTrigger`, меню
  відкривається **вправо** від сайдбара; акаунт-дропдаун із хедера прибраний;
- хедер лишає `SidebarTrigger` зліва і **дзвінок + перемикач теми** справа (рішення
  користувача) — тобто те, що стосується поточного екрана, а не сесії;
- `collapsible="icon"` замість дефолтного `offcanvas` — як у прикладу, з якого взято
  розкладку: згорнутий сайдбар стає смугою іконок 48px, а не зникає.

**Побічні зміни, яких вимагала розкладка:**

- `user-identity.tsx` **переїхав у `libs/ui`** (`@saas-skeleton/ui/components/user-identity`) —
  тепер обидва шели малюють однаковий рядок юзера; компонент був повністю generic;
- в `Item` додано `flex-nowrap`: стоковий варіант переносить вміст, і у згорнутому сайдбарі
  текст падав під аватар замість того, щоб обрізатись.

**Перевірено наживо** (обидва застосунки): бренд-рядок «SaaS Skeleton / Workspace» і
«Platform Console / Control plane»; футер із «Admin / admin@example.com» і «Platform Operator
/ platform@example.com», меню «Log out» відкривається вправо; хедер — тригер + дзвінок + тема
(у platform-web лише тема); згортання 256px ↔ 48px, у смузі лишаються плитка логотипа, іконки
навігації й аватар без «хвостів» тексту.

**Якщо колись купимо ліцензію ReUI** — правило: блоки тягнути **в застосунок**, а не в
`libs/ui`, і перевіряти, чи не тягнуть вони `@reui/*` примітиви (це був би другий набір
базових компонентів поруч із нашим — рівно те, від чого застерігає правило 12 CLAUDE.md).
