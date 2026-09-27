# Візерунки для брендового фону: дослідження

> 2026-09-26. Довідка до `docs/frontend/brand-backdrop.md`: що розглядали на місце
> лінійної сітки і як можна зробити «глобус із точок». Посилання перевірені (відповідають
> 200 і ведуть на потрібну сторінку); опис того, що на них зараз показано, — з пам'яті, а
> лендинги часто оновлюються.

## 1. Звідки почали

Референс — DeepSeek Harness, https://www.deepseek.com/harness/en/ . Зняли з живої сторінки:
основа `#0a0a0a`, лінійна сітка 90px (1px білого ≈4%, на canvas з анімацією), три розмиті
плями темно-синього, скляні поверхні (біле 2…6% + inset-хайлайт). Лінійна сітка в нас
зливалася з межами шела (ті самі 1px-лінії), тому її замінили точками лише в місцях плям —
див. `brand-backdrop.md` §2.

## 2. Варіанти візерунка

| Варіант | Суть | Конфлікт із межами UI | Вага |
| --- | --- | --- | --- |
| **Точки** (обрано) | `radial-gradient` із кроком | немає — ліній нема | 0 КБ, CSS |
| Зерно / шум | фактура поверх плям | немає | SVG-фільтр або ~кілька КБ |
| Діагональне штрихування | нахилені лінії | малий — не паралельні межам | 0 КБ, CSS |
| Промені / прожектор | `conic-gradient` + блюр | немає | 0 КБ, CSS |
| Топографія / хвилі | органічні криві | немає | SVG на кілька КБ |
| Mesh-градієнт | плями, що перетікають | немає | 0 КБ, CSS |
| Лінійна сітка | як у DeepSeek | **так** — зливається | 0 КБ, CSS |

### Точкові візерунки
- Clerk — https://clerk.com — точки в секціях лендингу.
- Magic UI, Dot Pattern — https://magicui.design/docs/components/dot-pattern
- Magic UI, Flickering Grid — https://magicui.design/docs/components/flickering-grid
- Aceternity, Grid and Dot Backgrounds — https://ui.aceternity.com/components/grid-and-dot-backgrounds

### Зерно / шум
- Linear — https://linear.app — плями й зерно, без сітки.
- Raycast — https://www.raycast.com — яскраві плями з фактурою.
- Генератори: https://www.fffuel.co/gggrain/ (градієнт із зерном), https://www.fffuel.co/nnnoise/ (шум SVG).

### Штрихування
- Tailwind CSS — https://tailwindcss.com — штриховані поля.
- Каталоги SVG-візерунків: https://heropatterns.com , https://pattern.monster

### Промені / прожектор
- Resend — https://resend.com
- Supabase — https://supabase.com
- Aceternity: https://ui.aceternity.com/components/spotlight , https://ui.aceternity.com/components/background-beams

### Топографія / хвилі
- https://haikei.app (топографія, хвилі, плями), https://www.fffuel.co/ttten/

### Mesh-градієнт
- Stripe — https://stripe.com
- Генератор: https://csshero.org/mesher/

### Лінійна сітка, зроблена як деталь
- Vercel — https://vercel.com — розірвана сітка з «+» на перетинах.

### Збірки готових CSS-фонів
- https://bg.ibelick.com

## 3. Глобус / карта світу з точок

**Що це.** Земна куля або пласка карта, де суша — це точки на регулярній сітці, а океан —
порожнеча. Поверх зазвичай кладуть «покриття»: піни (регіони, дата-центри, користувачі) і
дуги між ними — метафора мережі, що охоплює світ. Англійські назви для пошуку:
*dotted globe*, *dot matrix world map*, *halftone globe*, *dotted world map*.

### 3.1 Де це видно

| Де | Що | Як зроблено (з публікацій / за спостереженням) |
| --- | --- | --- |
| GitHub, головна — https://github.com | обертовий глобус, точки-суша, дуги pull-request'ів | WebGL (three.js). Розбір: https://github.blog/engineering/engineering-principles/how-we-built-the-github-globe/ |
| Stripe — стаття https://stripe.com/blog/globe | інтерактивний глобус із точок | WebGL; стаття — про дизайн і розробку саме цього глобуса |
| Cloudflare — https://www.cloudflare.com/network/ | карта мережі дата-центрів | точки міст на карті світу |
| Vercel — https://vercel.com/docs/edge-network/regions | регіони edge-мережі | карта з точками регіонів |
| Supabase — https://supabase.com/docs/guides/platform/regions | регіони розгортання | карта регіонів |

### 3.2 Готові інструменти

| Інструмент | Що дає | Рантайм | Ліцензія |
| --- | --- | --- | --- |
| **dotted-map** — https://github.com/NTag/dotted-map | SVG карти з точок; проєкції `mercator`, `robinson`, `equalEarth`, **`orthographic`** (глобус, одна півкуля) із `center`; форма точки `circle`/`hexagon`; піни | Node ≥18 або браузер; сітку можна **попередньо згенерувати** і віддати готовий SVG | MIT (v3.1.0) |
| **COBE** — https://cobe.vercel.app , https://github.com/shuding/cobe | обертовий WebGL-глобус із точок, маркери | canvas/WebGL, «~5KB, zero deps» (з README) | MIT |
| Magic UI Globe — https://magicui.design/docs/components/globe | React-обгортка з анімацією | на базі COBE | — |
| Magic UI Dotted Map — https://magicui.design/docs/components/dotted-map | пласка карта з точок | React | — |
| Aceternity World Map — https://ui.aceternity.com/components/world-map | пласка карта з точок + дуги між містами | React, SVG | — |
| Aceternity GitHub Globe — https://ui.aceternity.com/components/github-globe | глобус «як у GitHub» з дугами | three.js | — |
| globe.gl — https://globe.gl , react-globe.gl — https://github.com/vasturiano/react-globe.gl | повноцінний 3D-глобус: точки, гекси, дуги, шари даних | three.js (важкий) | — |
| amCharts Pixel Map — https://pixelmap.amcharts.com | генератор пласкої карти з точок/пікселів, експорт SVG/PNG | немає (готовий файл) | умови використання — перевірити |
| Дані суші: https://github.com/topojson/world-atlas , проєкції: https://d3js.org/d3-geo | якщо генерувати самим | — | — |

### 3.3 Картинка, CSS чи код?

**Чистим CSS — ні.** CSS уміє намалювати регулярні точки, але не знає, де суша: форму
континентів дають лише географічні дані. Реальні варіанти:

1. **Статичний SVG, попередньо згенерований** (`dotted-map`, `orthographic`) —
   *рекомендація для нашого фону.* Генеруємо один раз скриптом, кладемо файл у
   `libs/ui`, вставляємо в `BrandBackdrop` у місці однієї з плям. Колір точок — через
   `fill="currentColor"` або CSS-змінну (замінити захардкожений колір у згенерованому SVG),
   тож світла/темна тема й `--primary` працюють як з рештою фону. Без рантайму і JS.
   Ризик — вага: кожна точка — окремий `<circle>`, розмір файла залежить від щільності
   (`height` сітки) — підібрати й виміряти до коміту.
2. **CSS-точки + маска континентів.** Наші ж точки (`radial-gradient`), а форма суші — через
   `mask-image: url(world.svg)` (контури континентів, кілька–кільканадцять КБ). Точки тоді
   стоять на тій самій сітці, що й решта фону, і тема працює безкоштовно. Але так виходить
   лише **пласка** карта; сферу CSS не спроєктує.
3. **Картинка (AVIF/PNG).** Найпростіше, але дві версії під теми, не бере `--primary`,
   розмиття на великих екранах.
4. **Анімований глобус (COBE).** Найефектніше і легке (~5KB), але це WebGL-canvas з
   постійною анімацією — суперечить рішенню «фон без анімації» і коштує GPU на кожній
   вітринній сторінці. Доречно в окремому hero-блоці, а не у фоні під усім вікном.

«Покриття мережею» поверх будь-якого з варіантів — піни (`dotted-map.addPin`, маркери COBE)
і, за бажання, дуги (SVG-`path` із `stroke-dasharray`).

## 4. Наступний крок, якщо беремо глобус

Прототип варіанта 1: скрипт генерації (`dotted-map`, `orthographic`, центр на Європі),
SVG у `libs/ui`, розміщення під великою плямою ліворуч, колір від `--backdrop-dot`.
Виміряти вагу SVG при 2–3 щільностях і порівняти з варіантом 2 (пласка карта маскою).
