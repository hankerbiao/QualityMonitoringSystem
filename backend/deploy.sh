#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${VENV_DIR:-${APP_DIR}/.venv}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env}"
RUNTIME_DIR="${RUNTIME_DIR:-${APP_DIR}/.runtime}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
WORKERS="${WORKERS:-1}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
PID_FILE="${PID_FILE:-${RUNTIME_DIR}/backend-${PORT}.pid}"
SERVER_LOG="${SERVER_LOG:-${APP_DIR}/logs/uvicorn-${PORT}.log}"
HEALTH_HOST="${HEALTH_HOST:-127.0.0.1}"
HEALTH_URL="http://${HEALTH_HOST}:${PORT}/health"
VENV_PYTHON="${VENV_DIR}/bin/python"

info() { printf '[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
fail() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
QualiBoard Backend deployment helper

Usage:
  ./deploy.sh [command]

Commands:
  deploy       Create/update venv, install dependencies, then restart (default)
  install      Create/update venv and install dependencies only
  start        Start the backend in the background
  stop         Stop the backend managed by this script
  restart      Restart the managed backend
  status       Show process and health status
  health       Call the backend health endpoint
  logs         Follow the uvicorn output log
  init-config  Explicitly run init_default_settings.py
  help         Show this help

Environment overrides:
  PYTHON_BIN=python3  VENV_DIR=.venv  HOST=0.0.0.0  PORT=8000
  WORKERS=1          ENV_FILE=.env   SERVER_LOG=logs/uvicorn-8000.log

Examples:
  chmod +x deploy.sh
  ./deploy.sh
  PORT=8010 ./deploy.sh deploy
  ./deploy.sh logs
EOF
}

require_python() {
  command -v "$PYTHON_BIN" >/dev/null 2>&1 || fail "Python not found: ${PYTHON_BIN}"
  "$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' \
    || fail "Python 3.10 or newer is required"
}

env_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$ENV_FILE"
}

set_env_value() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

random_secret() {
  "$PYTHON_BIN" -c 'import secrets; print(secrets.token_urlsafe(48))'
}

fernet_key() {
  "$PYTHON_BIN" -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
}

ensure_env() {
  local created=false
  require_python
  if [[ ! -f "$ENV_FILE" ]]; then
    [[ -f "${APP_DIR}/.env.example" ]] || fail ".env.example not found"
    cp "${APP_DIR}/.env.example" "$ENV_FILE"
    created=true
    info "Created ${ENV_FILE} from .env.example"
  fi

  if [[ "$created" == true ]]; then
    set_env_value "DEBUG" "false"
  fi
  [[ -n "$(env_value PROCESS_RECORD_CREDENTIAL_KEY)" ]] \
    || set_env_value "PROCESS_RECORD_CREDENTIAL_KEY" "$(fernet_key)"
  [[ -n "$(env_value JWT_SECRET)" ]] \
    || set_env_value "JWT_SECRET" "$(random_secret)"
  [[ -n "$(env_value ALERT_TOKEN_SECRET)" ]] \
    || set_env_value "ALERT_TOKEN_SECRET" "$(random_secret)"
  chmod 600 "$ENV_FILE"

  if [[ -z "$(env_value OA_JWT_SECRET)" ]]; then
    warn "OA_JWT_SECRET is not set in .env; configure the OA-issued secret before production use"
  fi
  if [[ "$(env_value DEBUG)" == "true" ]]; then
    warn "DEBUG=true; set DEBUG=false before production use"
  fi
}

ensure_venv() {
  require_python
  if [[ ! -x "$VENV_PYTHON" ]]; then
    info "Creating virtual environment: ${VENV_DIR}"
    "$PYTHON_BIN" -m venv "$VENV_DIR"
  fi
}

install_app() {
  ensure_env
  ensure_venv
  info "Installing backend and runtime dependencies"
  "$VENV_PYTHON" -m pip install --disable-pip-version-check --upgrade pip setuptools wheel
  "$VENV_PYTHON" -m pip install --disable-pip-version-check --upgrade "$APP_DIR"
  (
    cd "$APP_DIR"
    "$VENV_PYTHON" -c 'from app.main import app; print(f"Import check passed: {app.title}")'
  )
}

read_pid() {
  [[ -f "$PID_FILE" ]] && tr -d '[:space:]' < "$PID_FILE" || true
}

is_running() {
  local pid
  pid="$(read_pid)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

port_is_open() {
  "$VENV_PYTHON" -c \
    'import socket, sys; s=socket.socket(); s.settimeout(.3); rc=s.connect_ex((sys.argv[1], int(sys.argv[2]))); s.close(); raise SystemExit(0 if rc == 0 else 1)' \
    "$HEALTH_HOST" "$PORT"
}

health_check() {
  "$VENV_PYTHON" - "$HEALTH_URL" <<'PY'
import sys
import urllib.request

try:
    response = urllib.request.urlopen(sys.argv[1], timeout=5)
    print(response.read().decode())
    raise SystemExit(0 if response.status == 200 else 1)
except Exception as exc:
    print(f"Health request failed: {exc}", file=sys.stderr)
    raise SystemExit(1)
PY
}

wait_until_healthy() {
  local attempt
  for attempt in $(seq 1 30); do
    if health_check >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_app() {
  ensure_env
  ensure_venv
  [[ "$WORKERS" =~ ^[1-9][0-9]*$ ]] || fail "WORKERS must be a positive integer"
  if (( WORKERS > 1 )) && [[ "${ALLOW_MULTIPLE_WORKERS:-false}" != "true" ]]; then
    fail "WORKERS>1 would run APScheduler jobs more than once; set ALLOW_MULTIPLE_WORKERS=true only after externalizing the scheduler"
  fi
  if is_running; then
    info "Backend already running (PID $(read_pid))"
    return 0
  fi
  rm -f "$PID_FILE"
  if port_is_open; then
    fail "Port ${PORT} is already in use by a process not managed by this script"
  fi

  mkdir -p "$RUNTIME_DIR" "$(dirname "$SERVER_LOG")"
  info "Starting backend on ${HOST}:${PORT}"
  (
    cd "$APP_DIR"
    nohup "$VENV_PYTHON" -m uvicorn app.main:app \
      --host "$HOST" --port "$PORT" --workers "$WORKERS" \
      >> "$SERVER_LOG" 2>&1 < /dev/null &
    echo "$!" > "$PID_FILE"
  )

  if wait_until_healthy; then
    info "Backend is healthy (PID $(read_pid)): ${HEALTH_URL}"
    return 0
  fi

  warn "Backend failed its health check; recent log output:"
  tail -n 40 "$SERVER_LOG" >&2 || true
  stop_app || true
  return 1
}

stop_app() {
  local pid attempt
  pid="$(read_pid)"
  if [[ -z "$pid" ]]; then
    info "No managed backend process found"
    return 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$PID_FILE"
    info "Removed stale PID file"
    return 0
  fi

  info "Stopping backend (PID ${pid})"
  kill "$pid"
  for attempt in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      info "Backend stopped"
      return 0
    fi
    sleep 1
  done
  warn "Process did not stop gracefully; sending SIGKILL"
  kill -9 "$pid"
  rm -f "$PID_FILE"
}

show_status() {
  if [[ ! -x "$VENV_PYTHON" ]]; then
    warn "Virtual environment does not exist: ${VENV_DIR}"
    return 1
  fi
  if is_running; then
    info "Managed backend is running (PID $(read_pid))"
  else
    warn "Managed backend is not running"
  fi
  if health_check; then
    info "Health check passed: ${HEALTH_URL}"
  else
    warn "Health check failed: ${HEALTH_URL}"
    return 1
  fi
}

command="${1:-deploy}"
case "$command" in
  deploy)
    install_app
    stop_app
    start_app
    ;;
  install) install_app ;;
  start) start_app ;;
  stop) stop_app ;;
  restart)
    stop_app
    start_app
    ;;
  status) show_status ;;
  health)
    [[ -x "$VENV_PYTHON" ]] || fail "Virtual environment does not exist: ${VENV_DIR}"
    health_check
    ;;
  logs)
    mkdir -p "$(dirname "$SERVER_LOG")"
    touch "$SERVER_LOG"
    tail -n 100 -f "$SERVER_LOG"
    ;;
  init-config)
    install_app
    warn "This command writes default configuration values to MongoDB"
    (cd "$APP_DIR" && "$VENV_PYTHON" init_default_settings.py)
    ;;
  help|-h|--help) usage ;;
  *)
    usage >&2
    fail "Unknown command: ${command}"
    ;;
esac
