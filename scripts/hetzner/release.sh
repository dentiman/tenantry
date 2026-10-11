#!/usr/bin/env bash
# Локальний шлях до деплою на Hetzner: повна перевірка → push у github/main (його деплоїть
# .github/workflows/deploy.yml). Verify у GitHub-пайплайн свідомо НЕ входить (docs/deploy-hetzner.md §2),
# тож ця команда — єдиний шлюз перед розкатом.
#
#   pnpm release:hetzner              # перевірити поточну гілку й запушити її в github/main
#   SKIP_VERIFY=1 pnpm release:hetzner   # лише запушити (правка CI/доків, термінове виправлення)
#
# Перевіряється робоча тека, а пушиться HEAD, тому дерево мусить бути чистим: інакше
# перевірили б не той код, що поїде на сервер.
set -euo pipefail
cd "$(dirname "$0")/../.."

REMOTE=github
TARGET=main
die() { echo "release: $*" >&2; exit 1; }

src="$(git rev-parse --abbrev-ref HEAD)"
[ "$src" != HEAD ] || die "detached HEAD — стань на гілку"
[ -z "$(git status --porcelain)" ] || die "є незакомічені/неві́дстежувані зміни — закоміть або прибери їх"

git fetch --quiet "$REMOTE" "$TARGET"
remote_sha="$(git rev-parse "$REMOTE/$TARGET")"
head_sha="$(git rev-parse HEAD)"

[ "$remote_sha" != "$head_sha" ] || die "HEAD уже збігається з $REMOTE/$TARGET — нічого розкочувати (перерозкат: Actions → CI/CD → Run workflow)"
git merge-base --is-ancestor "$remote_sha" HEAD \
  || die "$REMOTE/$TARGET має коміти, яких нема в '$src' — спершу злий їх (merge/rebase), без force-push"

if [ "${SKIP_VERIFY:-}" = 1 ]; then
  echo "→ SKIP_VERIFY=1: перевірку пропущено"
else
  echo "→ verify локально (потрібен Docker; dev-стек не зачіпається)…"
  bash scripts/ci-verify.sh
fi

echo "→ push $src → $REMOTE/$TARGET (це запускає деплой)"
git push "$REMOTE" "HEAD:refs/heads/$TARGET"

# Локальний main — дзеркало: підтягуємо його, якщо це fast-forward і він не поточна гілка
if [ "$src" != "$TARGET" ] && git merge-base --is-ancestor "$TARGET" HEAD 2>/dev/null; then
  git branch -f "$TARGET" HEAD
fi
echo "Готово. Стежити за розкатом: gh run watch --repo dentiman/saas-skeleton"
