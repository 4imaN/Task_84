import type { VersionedMigration } from '../index';

export const initialSchemaMigration: VersionedMigration = {
  version: '001_initial_schema',
  statements: [
    `
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE,
      username_cipher TEXT,
      username_lookup_hash TEXT,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      external_identifier_cipher TEXT NOT NULL,
      is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      workspace TEXT NOT NULL,
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS authors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS series (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS titles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      format TEXT NOT NULL,
      author_id UUID NOT NULL REFERENCES authors(id),
      series_id UUID REFERENCES series(id),
      price_cents INTEGER NOT NULL,
      inventory_on_hand INTEGER NOT NULL DEFAULT 0,
      bestseller_rank INTEGER NOT NULL DEFAULT 9999,
      digital_asset JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title_id UUID NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      chapter_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      body_simplified TEXT NOT NULL,
      body_traditional TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reading_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      device_label TEXT NOT NULL,
      preferences JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title_id UUID NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, title_id)
    );

    CREATE TABLE IF NOT EXISTS author_subscriptions (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author_id UUID NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, author_id)
    );

    CREATE TABLE IF NOT EXISTS series_subscriptions (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, series_id)
    );

    CREATE TABLE IF NOT EXISTS ratings (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title_id UUID NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, title_id)
    );

    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (blocker_user_id, blocked_user_id)
    );

    CREATE TABLE IF NOT EXISTS user_mutes (
      muter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      muted_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (muter_user_id, muted_user_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title_id UUID NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
      comment_type TEXT NOT NULL DEFAULT 'COMMENT',
      body TEXT NOT NULL,
      is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
      duplicate_fingerprint TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
      reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      notes TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS moderation_actions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      moderator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
      target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      target_comment_id UUID REFERENCES comments(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      notes TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sensitive_words (
      word TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sku TEXT NOT NULL UNIQUE,
      title_id UUID REFERENCES titles(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      on_hand INTEGER NOT NULL DEFAULT 0,
      moving_average_cost_cents INTEGER NOT NULL DEFAULT 0,
      freight_cents INTEGER NOT NULL DEFAULT 0,
      surcharge_cents INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bundle_links (
      inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      complementary_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      PRIMARY KEY (inventory_item_id, complementary_item_id)
    );

    CREATE TABLE IF NOT EXISTS carts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      clerk_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
      inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (cart_id, inventory_item_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cart_id UUID NOT NULL UNIQUE REFERENCES carts(id) ON DELETE CASCADE,
      clerk_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payment_method TEXT NOT NULL,
      payment_note_cipher TEXT NOT NULL,
      subtotal_cents INTEGER NOT NULL,
      discount_cents INTEGER NOT NULL,
      fee_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      unit_cost_cents INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supplier_manifests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      uploaded_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      supplier_name TEXT NOT NULL,
      source_filename TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS supplier_manifest_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      manifest_id UUID NOT NULL REFERENCES supplier_manifests(id) ON DELETE CASCADE,
      sku TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      extended_amount_cents INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      supplier_name TEXT NOT NULL,
      status TEXT NOT NULL,
      note_cipher TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS discrepancy_flags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      manifest_id UUID NOT NULL REFERENCES supplier_manifests(id) ON DELETE CASCADE,
      sku TEXT NOT NULL,
      quantity_difference INTEGER NOT NULL,
      amount_difference_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rule_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_key TEXT NOT NULL,
      version INTEGER NOT NULL,
      definition JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      evidence_path TEXT,
      evidence_mime_type TEXT,
      evidence_checksum TEXT,
      previous_hash TEXT,
      current_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS risk_alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      attendance_record_id UUID REFERENCES attendance_records(id) ON DELETE CASCADE,
      rule_version_id UUID REFERENCES rule_versions(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      description TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS recommendation_snapshots (
      title_id UUID NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      snapshot_type TEXT NOT NULL,
      recommended_title_ids JSONB NOT NULL,
      refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (title_id, snapshot_type)
    );

    CREATE TABLE IF NOT EXISTS recommendation_traces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id TEXT NOT NULL,
      title_id UUID NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
      strategy TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trace_id TEXT NOT NULL,
      actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      previous_hash TEXT,
      current_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `,
  ],
};
