#!/bin/sh
set -eu

APP_DATA_ROOT="/var/lib/ledgerread"
KEY_DIR="$APP_DATA_ROOT/runtime"
KEY_FILE="$KEY_DIR/app_encryption_key"

if [ -z "${APP_ENCRYPTION_KEY:-}" ]; then
  mkdir -p "$KEY_DIR"

  if [ -f "$KEY_FILE" ]; then
    APP_ENCRYPTION_KEY="$(cat "$KEY_FILE")"
  else
    APP_ENCRYPTION_KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
    printf '%s' "$APP_ENCRYPTION_KEY" > "$KEY_FILE"
  fi

  export APP_ENCRYPTION_KEY
fi

if [ "$APP_ENCRYPTION_KEY" = "ledgerread-local-demo-secret" ]; then
  echo "APP_ENCRYPTION_KEY must not use the banned demo secret." >&2
  exit 1
fi

if [ -n "${DATABASE_ADMIN_URL:-}" ]; then
  APP_DATABASE_URL="${DATABASE_URL}" DATABASE_URL="${DATABASE_ADMIN_URL}" node apps/api/dist/scripts/migrate.js
  APP_DATABASE_URL="${DATABASE_URL}" DATABASE_URL="${DATABASE_ADMIN_URL}" node apps/api/dist/scripts/seed.js
else
  APP_DATABASE_URL="${APP_DATABASE_URL:-${DATABASE_URL:-}}" node apps/api/dist/scripts/migrate.js
  APP_DATABASE_URL="${APP_DATABASE_URL:-${DATABASE_URL:-}}" node apps/api/dist/scripts/seed.js
fi

node apps/api/dist/main.js
