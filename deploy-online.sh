#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_HOST="${DEPLOY_HOST:-10.17.150.235}"
REMOTE_USER="${DEPLOY_USER:-root}"
REMOTE_DIR="${DEPLOY_DIR:-/data/QualityMonitoringSystem}"
HTTP_PROXY_URL="${DEPLOY_HTTP_PROXY:-http://10.2.51.151:7897}"
SOCKS_PROXY_URL="${DEPLOY_SOCKS_PROXY:-socks5://10.2.51.151:7897}"

info() { printf '[deploy] %s\n' "$*"; }
fail() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || fail "git is required"
command -v sshpass >/dev/null 2>&1 || fail "sshpass is required for password-based SSH"

cd "$SCRIPT_DIR"
[[ -z "$(git status --porcelain --untracked-files=all)" ]] \
  || fail "Local worktree is not clean. Commit intended changes before deploying."

branch="$(git branch --show-current)"
[[ -n "$branch" ]] || fail "Detached HEAD; switch to a branch before deploying."
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1 \
  || fail "Current branch has no upstream; configure one before deploying."

info "Pushing branch ${branch} to origin"
git push origin "$branch"

if [[ -z "${DEPLOY_SSH_PASSWORD:-}" ]]; then
  read -r -s -p "SSH password for ${REMOTE_USER}@${REMOTE_HOST}: " DEPLOY_SSH_PASSWORD
  printf '\n'
fi
[[ -n "${DEPLOY_SSH_PASSWORD:-}" ]] || fail "SSH password is required"
export SSHPASS="$DEPLOY_SSH_PASSWORD"
unset DEPLOY_SSH_PASSWORD

printf -v remote_command 'APP_DIR=%q HTTP_PROXY_URL=%q SOCKS_PROXY_URL=%q bash -s' \
  "$REMOTE_DIR" "$HTTP_PROXY_URL" "$SOCKS_PROXY_URL"

info "Deploying on ${REMOTE_HOST}:${REMOTE_DIR}"
sshpass -e ssh \
  -o ConnectTimeout=15 \
  -o StrictHostKeyChecking=accept-new \
  "${REMOTE_USER}@${REMOTE_HOST}" \
  "$remote_command" <<'REMOTE_SCRIPT'
set -Eeuo pipefail

export http_proxy="$HTTP_PROXY_URL"
export https_proxy="$HTTP_PROXY_URL"
export all_proxy="$SOCKS_PROXY_URL"
export HTTP_PROXY="$http_proxy"
export HTTPS_PROXY="$https_proxy"
export ALL_PROXY="$all_proxy"
export no_proxy="${no_proxy:-localhost,127.0.0.1,10.17.0.0/16}"
export NO_PROXY="$no_proxy"
export BUILD_HTTP_PROXY="$http_proxy"
export BUILD_HTTPS_PROXY="$https_proxy"
export GIT_TERMINAL_PROMPT=0

cd "$APP_DIR"
[[ -d .git ]] || { printf '[deploy] ERROR: not a Git checkout: %s\n' "$APP_DIR" >&2; exit 1; }
[[ -f docker/compose.yaml ]] || { printf '[deploy] ERROR: Docker Compose file not found\n' >&2; exit 1; }
[[ -f docker/.env ]] || { printf '[deploy] ERROR: docker/.env is missing; configure production settings first\n' >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { printf '[deploy] ERROR: docker is not installed\n' >&2; exit 1; }
docker compose version >/dev/null

git fetch origin
upstream_ref="$(git rev-parse --symbolic-full-name '@{upstream}')"
incoming_paths="$(git diff --name-only HEAD "$upstream_ref")"
while IFS= read -r status_line; do
  [[ -n "$status_line" ]] || continue
  path="${status_line:3}"
  case "$path" in
    docker/.env|docker/compose.yaml)
      if grep -Fxq "$path" <<< "$incoming_paths"; then
        printf '[deploy] ERROR: remote configuration conflicts with incoming change: %s\n' "$path" >&2
        exit 1
      fi
      printf '[deploy] Preserving remote configuration: %s\n' "$path"
      ;;
    *)
      printf '[deploy] ERROR: unexpected remote worktree change: %s\n' "$path" >&2
      exit 1
      ;;
  esac
done < <(git status --porcelain=v1 --untracked-files=all)

printf '[deploy] Pulling latest commit through the configured proxy\n'
git pull --ff-only

printf '[deploy] Validating Compose configuration\n'
docker compose -f docker/compose.yaml config --quiet

printf '[deploy] Building and starting Docker services\n'
docker compose -f docker/compose.yaml up -d --build

healthy=false
for attempt in $(seq 1 60); do
  if docker compose -f docker/compose.yaml exec -T backend \
    python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" \
    >/dev/null 2>&1 \
    && docker compose -f docker/compose.yaml exec -T frontend \
    wget -qO- http://127.0.0.1/nginx-health >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "$healthy" != true ]]; then
  printf '[deploy] ERROR: service health check timed out; recent logs follow\n' >&2
  docker compose -f docker/compose.yaml logs --tail=60 >&2 || true
  exit 1
fi

printf '[deploy] Health checks passed\n'
docker compose -f docker/compose.yaml ps
REMOTE_SCRIPT

info "Deployment completed"
