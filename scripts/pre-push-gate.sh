#!/usr/bin/env bash
# Легкий офлайн-шлюз перед пушем: `pnpm lint` + `pnpm typecheck` (ESLint-заборони, межі модулів,
# цикли, корпус знань AI, типи). Без Docker, без БД, без e2e — повний `pnpm verify`
# (scripts/ci-verify.sh) лишається ручним за рішенням власника 2026-10-19 (надто довгий).
#
# Викликається з .husky/pre-push (git передає в stdin рядки
# `<local ref> <local sha> <remote ref> <remote sha>`), а також зі scripts/git-sync.sh, який
# подає такі самі рядки сам — один раз на всі свої пуші.
#
# Пропуск у крайньому випадку (шлюз сам скаже, що саме не перевірено):
#   SKIP_PREPUSH=1 git push …     # лише цей пуш
#   git push --no-verify …        # стандартний обхід git (мовчки)
#
# Не ганяємо, коли нема що перевіряти: видалення гілки/тегу, порожній набір комітів, пуш лише
# документації (ті самі шляхи, що пропускає deploy.yml, — AGENTS.md «Documentation-only
# publication»; винятки — вхідні дані застосунку docs/ai-knowledge/** і docs/history-summary.md).
#
# `PREPUSH_GATE_DONE=1` у оточенні = шлюз уже відпрацював вище за течією (release.sh після
# verify, git-sync між двома своїми пушами) — вдруге не ганяємо.
set -euo pipefail
cd "$(dirname "$0")/.."

ZERO='0000000000000000000000000000000000000000'

say() { echo "pre-push: $*" >&2; }

if [ -n "${PREPUSH_GATE_DONE:-}" ]; then
  say "шлюз уже пройдено вище за течією (PREPUSH_GATE_DONE) — пропускаю"
  exit 0
fi

if [ "${SKIP_PREPUSH:-}" = 1 ]; then
  say "SKIP_PREPUSH=1 — ПРОПУЩЕНО: pnpm lint, pnpm typecheck. Повний pnpm verify теж не запускався."
  exit 0
fi

# Чи всі змінені файли — документація, яку deploy.yml не вважає змінами застосунку
docs_only() {
  local f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      docs/ai-knowledge/* | docs/history-summary.md) return 1 ;;
      README.md | AGENTS.md | CLAUDE.md | LICENSE | docs/* | openspec/*) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

needs_gate=0
{
  while read -r _local_ref local_sha _remote_ref remote_sha; do
    [ -n "${local_sha:-}" ] || continue
    [ "$local_sha" != "$ZERO" ] || continue # видалення гілки/тегу
    if [ "$remote_sha" = "$ZERO" ]; then
      # нова гілка: перевіряємо, лише якщо в ній є коміти, яких нема в жодному remote
      [ -n "$(git rev-list -1 "$local_sha" --not --remotes 2>/dev/null)" ] || continue
      needs_gate=1
      break
    fi
    if ! git cat-file -e "$remote_sha^{commit}" 2>/dev/null; then
      needs_gate=1 # remote попереду або історія розійшлась — діффу нема, краще перевірити
      break
    fi
    [ "$local_sha" != "$remote_sha" ] || continue
    if ! git diff --name-only "$remote_sha" "$local_sha" | docs_only; then
      needs_gate=1
      break
    fi
  done
}

if [ "$needs_gate" = 0 ]; then
  say "нічого перевіряти (видалення, порожній пуш або лише документація) — lint/typecheck пропущено"
  exit 0
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  say "УВАГА: є незакомічені зміни — перевіряється робоча тека, а не пушуваний коміт"
fi

if [ ! -d node_modules ]; then
  say "нема node_modules — спершу \`pnpm install\` (або обійди: SKIP_PREPUSH=1 / --no-verify)"
  exit 1
fi
# Без згенерованого Prisma-клієнта ESLint (type-aware) дає ~2000 хибних помилок
if [ ! -d libs/database/src/generated ]; then
  say "Prisma-клієнт не згенеровано — pnpm db:generate (офлайн)"
  pnpm db:generate >/dev/null
fi

say "pnpm lint + pnpm typecheck паралельно (холодно ≈ 80–90 с, typecheck з кешу turbo ≈ 0 с)…"
log_dir="$(mktemp -d)"
trap 'rm -rf "$log_dir"' EXIT
start=$SECONDS
pnpm lint >"$log_dir/lint.log" 2>&1 &
lint_pid=$!
pnpm typecheck >"$log_dir/typecheck.log" 2>&1 &
type_pid=$!
lint_rc=0
type_rc=0
wait "$lint_pid" || lint_rc=$?
wait "$type_pid" || type_rc=$?

if [ "$lint_rc" != 0 ]; then
  say "pnpm lint ПРОВАЛЕНО:"
  tail -n 60 "$log_dir/lint.log" >&2
fi
if [ "$type_rc" != 0 ]; then
  say "pnpm typecheck ПРОВАЛЕНО:"
  tail -n 60 "$log_dir/typecheck.log" >&2
fi
if [ "$lint_rc" != 0 ] || [ "$type_rc" != 0 ]; then
  say "пуш скасовано. Екстрений обхід: SKIP_PREPUSH=1 git push … (або --no-verify)."
  exit 1
fi

say "ok за $((SECONDS - start)) с. НЕ перевірялось автоматично: e2e, unit, демо-сід — це \`pnpm verify\`, ручний."
