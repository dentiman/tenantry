# Design source — Multi user select

Джерела дизайн-канви для двох варіантів вибору кількох юзерів. Живуть у репозиторії
з тієї самої причини, що й `docs/`: рішення разом із кодом, а не в чужому сервісі.

| Файл              | Артборд                                                        |
| ----------------- | -------------------------------------------------------------- |
| `Main.dc.html`    | Inline — чипи в полі (клікабельний: чипи знімаються, попап живий) |
| `Stacked.dc.html` | Stacked — список рядків із drag & drop (клікабельний)            |
| `States.dc.html`  | Усі стани обох варіантів + точні розміри                        |
| `Dark.dc.html`    | Обидва варіанти в темній половині теми                          |
| `canvas.json`     | Розкладка канви: позиції артбордів, стікери, стартовий вигляд   |

**Опублікована канва:** https://claude.ai/code/artifact/17615a11-8323-433c-827b-9e5486a4ba42

## Що це за формат

`.dc.html` — Design Component: самодостатній HTML із розміткою, темою в `<helmet><style>`
і логікою в `class Component extends DCLogic`. Рядок `<script src="./support.js">` у `<head>`
обовʼязковий і НЕ редагується — рантайм підставляється при рендері, тож просто відкрити
файл у браузері не вийде: він оживає лише всередині канви.

Тема в кожному файлі — **копія** токенів `libs/ui/src/styles.css` літеральними `oklch()`
(артборди ізольовані один від одного і від Tailwind, спільного CSS у них немає). Тому при
зміні теми платформи ці файли не оновлюються самі — вони фіксують стан на момент дизайну.

## Як перезібрати канву після правок

```bash
node "<skill>/seed-canvas.mjs" \
  --template "<skill>/payload.template.html" \
  --out multi-user-select.html --title "Multi User Select" \
  --artboard Main.dc.html --artboard Stacked.dc.html \
  --artboard States.dc.html --artboard Dark.dc.html \
  --canvas canvas.json
```

Зібраний `multi-user-select.html` (~2 МБ, редактор усередині) свідомо **не комітиться** —
у репозиторії лишаються тільки джерела.

## Що з цього стало кодом

`apps/web/src/components/user-multi-select/` — див. `docs/frontend/multi-user-select.md`.
Живий стенд обох варіантів: `/playground/multi-user-select`.
