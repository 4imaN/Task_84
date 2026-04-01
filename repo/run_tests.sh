#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage: ./run_tests.sh [mode]

Modes:
  all        Run API + web tests
  api        Run docker-backed API tests
  api-local  Run API tests against an existing local PostgreSQL instance
  web        Run web unit/component tests
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

ensure_deps() {
  if [ ! -d "node_modules" ]; then
    echo "[run_tests] node_modules not found. Running npm install..."
    npm install
  fi
}

run_api() {
  echo "[run_tests] Running API tests (docker-backed)..."
  npm run test:api
}

run_api_local() {
  echo "[run_tests] Running API tests (local PostgreSQL)..."
  npm run test:api:local
}

run_web() {
  echo "[run_tests] Running web tests..."
  npm run test:web
}

run_e2e() {
  echo "[run_tests] Starting docker stack for E2E..."
  docker compose up --build -d
  echo "[run_tests] Running Playwright E2E tests..."
  npm run test:web:e2e
}

MODE="${1:-full}"

case "$MODE" in
  all)
    ensure_deps
    run_api
    run_web
    ;;
  api)
    ensure_deps
    run_api
    ;;
  api-local)
    ensure_deps
    run_api_local
    ;;
  web)
    ensure_deps
    run_web
    ;;
  e2e)
    ensure_deps
    run_e2e
    ;;
  full)
    ensure_deps
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
