#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage: ./run_tests.sh [mode]

Modes:
  all        Run API + web tests in Docker/Node 20
  api        Run API tests in Docker/Node 20
  api-local  Run API tests against an existing local PostgreSQL instance
  web        Run web unit/component tests in Docker/Node 20
  e2e        Build/start docker stack and run Playwright E2E tests
  full       Run all + e2e (default)
  help       Show this help

Examples:
  ./run_tests.sh
  ./run_tests.sh api
  ./run_tests.sh e2e
  ./run_tests.sh full
EOF
}

APP_IMAGE_READY=0

ensure_host_deps() {
  if [ ! -d "node_modules" ]; then
    echo "[run_tests] node_modules not found. Running npm install..."
    npm install
  fi
}

ensure_app_image() {
  if [ "$APP_IMAGE_READY" -eq 0 ]; then
    echo "[run_tests] Building app image for Docker-based tests..."
    docker compose build app
    APP_IMAGE_READY=1
  fi
}

stop_app_service() {
  docker compose stop app >/dev/null 2>&1 || true
}

run_api() {
  echo "[run_tests] Running API tests in Docker/Node 20..."
  ensure_app_image
  docker compose up -d postgres
  stop_app_service
  docker compose run --rm \
    -e NODE_ENV=test \
    -e DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ledgerread \
    -e APP_BASE_URL=http://localhost:4000 \
    -e SESSION_TTL_MINUTES=30 \
    -e EVIDENCE_STORAGE_ROOT=/tmp/ledgerread-evidence \
    app npm run test:api:local
}

run_api_local() {
  echo "[run_tests] Running API tests (local PostgreSQL)..."
  ensure_host_deps
  npm run test:api:local
}

run_web() {
  echo "[run_tests] Running web tests in Docker/Node 20..."
  ensure_app_image
  docker compose run --rm -e NODE_ENV=test app npm run test:web
}

run_e2e() {
  ensure_host_deps
  echo "[run_tests] Starting docker stack for E2E..."
  ensure_app_image
  docker compose up -d postgres app
  echo "[run_tests] Running Playwright E2E tests..."
  npm run test:web:e2e
}

MODE="${1:-full}"

case "$MODE" in
  all)
    run_api
    run_web
    ;;
  api)
    run_api
    ;;
  api-local)
    run_api_local
    ;;
  web)
    run_web
    ;;
  e2e)
    run_e2e
    ;;
  full)
    run_api
    run_web
    run_e2e
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "Unknown mode: $MODE"
    echo
    usage
    exit 1
    ;;
esac
