#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"

BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-4001}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-4000}"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-30}"
SKIP_INSTALL="${SKIP_INSTALL:-false}"
ACTION="start"

BACKEND_PID=""
FRONTEND_PID=""
RUN_DIR="${ROOT_DIR}/.run"
BACKEND_PID_FILE="${RUN_DIR}/backend.pid"
FRONTEND_PID_FILE="${RUN_DIR}/frontend.pid"

info() {
  printf '[start] %s\n' "$*"
}

fail() {
  printf '[start] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
QualiBoard source development launcher

Usage:
  ./start.sh [start|stop|restart] [--skip-install]

The launcher starts:
  Frontend: http://localhost:4000
  Backend:  http://localhost:4001

Environment overrides:
  BACKEND_HOST=0.0.0.0  BACKEND_PORT=4001
  FRONTEND_HOST=0.0.0.0 FRONTEND_PORT=4000
  STARTUP_TIMEOUT_SECONDS=30
  SKIP_INSTALL=false

Examples:
  ./start.sh
  ./start.sh start
  ./start.sh stop
  ./start.sh restart --skip-install
  ./start.sh --skip-install
  BACKEND_PORT=4011 ./start.sh
EOF
}

parse_args() {
  local arg

  for arg in "$@"; do
    case "$arg" in
      start|stop|restart)
        ACTION="$arg"
        ;;
      --skip-install)
        SKIP_INSTALL=true
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        usage >&2
        fail "Unknown option: $arg"
        ;;
    esac
  done
}

require_commands() {
  command -v uv >/dev/null 2>&1 || fail "uv is required. Install it before starting the backend."
  command -v npm >/dev/null 2>&1 || fail "npm is required. Install Node.js before starting the frontend."
  command -v curl >/dev/null 2>&1 || fail "curl is required for startup health checks."
  [[ -d "$BACKEND_DIR" ]] || fail "Backend directory not found: $BACKEND_DIR"
  [[ -d "$FRONTEND_DIR" ]] || fail "Frontend directory not found: $FRONTEND_DIR"
  [[ -f "$BACKEND_DIR/.env" ]] || fail "Missing backend/.env. Copy backend/.env.example and configure DATA_GATEWAY_URL first."
  [[ "$STARTUP_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] \
    || fail "STARTUP_TIMEOUT_SECONDS must be a positive integer, got: ${STARTUP_TIMEOUT_SECONDS}"
}

wait_for_http() {
  local service="$1"
  local url="$2"
  local attempt

  for attempt in $(seq 1 "$STARTUP_TIMEOUT_SECONDS"); do
    if curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1; then
      info "${service} is ready: ${url}"
      return 0
    fi
    sleep 1
  done

  fail "${service} did not become ready: ${url}"
}

ensure_port_available() {
  local service="$1"
  local port="$2"
  local env_name="$3"

  [[ "$port" =~ ^[0-9]+$ ]] || fail "${env_name} must be a numeric port, got: ${port}"

  if command -v lsof >/dev/null 2>&1 \
    && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "${service} port ${port} is already in use. Set another port, for example ${env_name}=$((port + 1))."
  fi
}

prepare_dependencies() {
  if [[ "$SKIP_INSTALL" == "true" ]]; then
    [[ -x "$BACKEND_DIR/.venv/bin/python" ]] \
      || fail "backend/.venv is missing; run 'cd backend && uv sync' or remove --skip-install."
    [[ -x "$FRONTEND_DIR/node_modules/.bin/vite" ]] \
      || fail "frontend dependencies are missing; run 'cd frontend && npm ci' or remove --skip-install."
    return
  fi

  if [[ ! -x "$BACKEND_DIR/.venv/bin/python" ]]; then
    info "Creating backend virtual environment and installing dependencies"
    (cd "$BACKEND_DIR" && uv sync)
  else
    info "Using existing backend virtual environment"
  fi

  if [[ ! -x "$FRONTEND_DIR/node_modules/.bin/vite" ]]; then
    info "Installing frontend dependencies"
    (cd "$FRONTEND_DIR" && npm ci)
  else
    info "Using existing frontend dependencies"
  fi
}

kill_tree() {
  local pid="$1"
  local child

  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    info "Stopping backend (PID ${BACKEND_PID})"
    kill_tree "$BACKEND_PID"
  fi
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    info "Stopping frontend (PID ${FRONTEND_PID})"
    kill_tree "$FRONTEND_PID"
  fi

  rm -f "$BACKEND_PID_FILE" "$FRONTEND_PID_FILE"
  wait "$BACKEND_PID" 2>/dev/null || true
  wait "$FRONTEND_PID" 2>/dev/null || true
  exit "$exit_code"
}

write_pid_file() {
  local pid_file="$1"
  local pid="$2"

  mkdir -p "$RUN_DIR"
  printf '%s\n' "$pid" > "$pid_file"
}

stop_service() {
  local service="$1"
  local pid_file="$2"
  local pid
  local attempt

  if [[ ! -f "$pid_file" ]]; then
    info "${service} is not managed by start.sh"
    return
  fi

  pid="$(<"$pid_file")"
  if [[ ! "$pid" =~ ^[1-9][0-9]*$ ]] || ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pid_file"
    info "${service} is not running"
    return
  fi

  info "Stopping ${service} (PID ${pid})"
  kill_tree "$pid"
  for attempt in {1..25}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  rm -f "$pid_file"
}

stop_services() {
  stop_service "Backend" "$BACKEND_PID_FILE"
  stop_service "Frontend" "$FRONTEND_PID_FILE"
  rmdir "$RUN_DIR" 2>/dev/null || true
}

start_services() {
  export VITE_API_PROXY_TARGET="${VITE_API_PROXY_TARGET:-http://127.0.0.1:${BACKEND_PORT}}"

  info "Starting backend on ${BACKEND_HOST}:${BACKEND_PORT}"
  (
    cd "$BACKEND_DIR"
    exec uv run uvicorn app.main:app \
      --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT"
  ) &
  BACKEND_PID=$!
  write_pid_file "$BACKEND_PID_FILE" "$BACKEND_PID"

  info "Starting frontend on ${FRONTEND_HOST}:${FRONTEND_PORT}"
  (
    cd "$FRONTEND_DIR"
    exec npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --strictPort
  ) &
  FRONTEND_PID=$!
  write_pid_file "$FRONTEND_PID_FILE" "$FRONTEND_PID"

  info "Services are running. Press Ctrl+C to stop both."
  info "Frontend: http://localhost:${FRONTEND_PORT}"
  info "Backend health: http://localhost:${BACKEND_PORT}/health"

  wait_for_http "Backend" "http://127.0.0.1:${BACKEND_PORT}/health"
  wait_for_http "Frontend" "http://127.0.0.1:${FRONTEND_PORT}/"
}

wait_for_services() {
  local status

  while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
    sleep 1
  done

  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    wait "$BACKEND_PID" || status=$?
    status="${status:-0}"
    fail "Backend exited with status ${status}."
  fi

  wait "$FRONTEND_PID" || status=$?
  status="${status:-0}"
  fail "Frontend exited with status ${status}."
}

main() {
  parse_args "$@"

  if [[ "$ACTION" == "stop" ]]; then
    stop_services
    return
  fi

  if [[ "$ACTION" == "restart" ]]; then
    stop_services
  fi

  require_commands
  ensure_port_available "Backend" "$BACKEND_PORT" "BACKEND_PORT"
  ensure_port_available "Frontend" "$FRONTEND_PORT" "FRONTEND_PORT"
  prepare_dependencies

  trap cleanup EXIT
  trap 'exit 130' INT TERM

  start_services
  wait_for_services
}

main "$@"
