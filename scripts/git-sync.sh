#!/usr/bin/env bash
# Синхронізація гілок між двома remote-ами. Джерело правди — GitHub `github`
# (dentiman/tenantry, публічний); GitLab `origin` несе той самий код (той самий SHA), а не копію.
#
#   pnpm git:sync          # поточний `dev` → dev на обох remote-ах (Hetzner НЕ деплоїться)
#   pnpm release:hetzner   # verify → dev і main на обох remote-ах (main на GitHub деплоїть Hetzner)
#
# Лише fast-forward: якщо remote має коміти, яких нема локально, скрипт зупиняється — спершу
# `git pull --ff-only github dev` / злити, ніколи не force-push. Пуш `dev` в GitLab запускає
# розкат saas-dev (.gitlab-ci.yml). GitLab доступний лише з робочої мережі: недоступний → попередження,
# GitHub однаково оновлюється, а GitLab наздоганяє наступним запуском.
#
# Бібліотека для release.sh: `SYNC_BRANCHES="dev main"` задає, які гілки ставити на HEAD.
set -euo pipefail
cd "$(dirname "$0")/.."

PRIMARY=github
MIRROR=origin
BRANCHES="${SYNC_BRANCHES:-dev}"
die() { echo "sync: $*" >&2; exit 1; }

src="$(git rev-parse --abbrev-ref HEAD)"
[ "$src" = dev ] || die "синхронізується лише гілка dev (зараз: $src)"
head="$(git rev-parse HEAD)"

# ff-only перевірка для одного remote; 0 — можна пушити, 1 — remote недоступний (лише для MIRROR)
check_ff() {
  local remote="$1" b
  git fetch --quiet "$remote" || return 1
  for b in $BRANCHES; do
    git rev-parse -q --verify "refs/remotes/$remote/$b" >/dev/null || continue
    git merge-base --is-ancestor "$remote/$b" "$head" \
      || die "$remote/$b має коміти, яких нема в dev — спершу злий їх (без force-push)"
  done
}

refspecs() { local b; for b in $BRANCHES; do printf 'HEAD:refs/heads/%s ' "$b"; done; }

check_ff "$PRIMARY" || die "$PRIMARY недоступний"
# shellcheck disable=SC2046
git push --atomic "$PRIMARY" $(refspecs)
echo "ok: $PRIMARY ← $BRANCHES @ $(git rev-parse --short HEAD)"

export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o ConnectTimeout=10}"
if check_ff "$MIRROR"; then
  # shellcheck disable=SC2046
  git push --atomic "$MIRROR" $(refspecs)
  echo "ok: $MIRROR ← $BRANCHES"
else
  echo "УВАГА: $MIRROR (GitLab) недоступний — він відстає; повтори \`pnpm git:sync\` з робочої мережі" >&2
fi

for b in $BRANCHES; do [ "$b" = "$src" ] || git branch -f "$b" HEAD; done
