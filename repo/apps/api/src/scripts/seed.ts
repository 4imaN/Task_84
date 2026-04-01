import * as argon2 from 'argon2';
import { Pool } from 'pg';
import { defaultReadingPreferences, seedUsers } from '@ledgerread/db';
import { createIdentifierLookupHash, encryptAtRestValue } from '../security/identifier';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ledgerread',
});

const configuredEncryptionKey = process.env.APP_ENCRYPTION_KEY?.trim();
if (!configuredEncryptionKey) {
  throw new Error('APP_ENCRYPTION_KEY is required before running the seed script.');
}
const encryptionKey: string = configuredEncryptionKey;

const upsertLookup = async (
  table: 'authors' | 'series',
  name: string,
) => {
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO ${table} (name)
    VALUES ($1)
    ON CONFLICT (name)
    DO UPDATE SET name = EXCLUDED.name
    RETURNING id
    `,
    [name],
  );

  return result.rows[0]!.id;
};

const upsertTitle = async (input: {
  slug: string;
  name: string;
  format: 'DIGITAL' | 'PHYSICAL' | 'BUNDLE';
  authorId: string;
  seriesId?: string;
  priceCents: number;
  inventoryOnHand: number;
  bestsellerRank: number;
}) => {
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO titles (slug, name, format, author_id, series_id, price_cents, inventory_on_hand, bestseller_rank, digital_asset)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    ON CONFLICT (slug)
    DO UPDATE SET name = EXCLUDED.name,
                  format = EXCLUDED.format,
                  author_id = EXCLUDED.author_id,
                  series_id = EXCLUDED.series_id,
                  price_cents = EXCLUDED.price_cents,
                  inventory_on_hand = EXCLUDED.inventory_on_hand,
                  bestseller_rank = EXCLUDED.bestseller_rank,
                  digital_asset = EXCLUDED.digital_asset
    RETURNING id
    `,
    [
      input.slug,
      input.name,
      input.format,
      input.authorId,
      input.seriesId ?? null,
      input.priceCents,
      input.inventoryOnHand,
      input.bestsellerRank,
      JSON.stringify({ format: 'ledgerread+json', version: 1 }),
    ],
  );

  return result.rows[0]!.id;
};

const upsertInventoryItem = async (input: {
  sku: string;
  titleId?: string;
  name: string;
  priceCents: number;
  onHand: number;
  movingAverageCostCents: number;
  freightCents: number;
  surchargeCents: number;
}) => {
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO inventory_items (sku, title_id, name, price_cents, on_hand, moving_average_cost_cents, freight_cents, surcharge_cents)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (sku)
    DO UPDATE SET title_id = EXCLUDED.title_id,
                  name = EXCLUDED.name,
                  price_cents = EXCLUDED.price_cents,
                  on_hand = EXCLUDED.on_hand,
                  moving_average_cost_cents = EXCLUDED.moving_average_cost_cents,
                  freight_cents = EXCLUDED.freight_cents,
                  surcharge_cents = EXCLUDED.surcharge_cents
    RETURNING id
    `,
    [
      input.sku,
      input.titleId ?? null,
      input.name,
      input.priceCents,
      input.onHand,
      input.movingAverageCostCents,
      input.freightCents,
      input.surchargeCents,
    ],
  );

  return result.rows[0]!.id;
};

async function main() {
  const userIds = new Map<string, string>();

  for (const user of seedUsers) {
    const passwordHash = await argon2.hash(user.password);
    const usernameLookupHash = createIdentifierLookupHash(encryptionKey, user.username);
    const result = await pool.query<{ id: string }>(
      `
      INSERT INTO users (
        username,
        username_cipher,
        username_lookup_hash,
        display_name,
        role,
        password_hash,
        external_identifier_cipher
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (username_lookup_hash)
      DO UPDATE SET username = EXCLUDED.username,
                    username_cipher = EXCLUDED.username_cipher,
                    username_lookup_hash = EXCLUDED.username_lookup_hash,
                    display_name = EXCLUDED.display_name,
                    role = EXCLUDED.role,
                    password_hash = EXCLUDED.password_hash,
                    external_identifier_cipher = EXCLUDED.external_identifier_cipher,
                    is_suspended = FALSE,
                    failed_login_attempts = 0,
                    locked_until = NULL
      RETURNING id
      `,
      [
        null,
        encryptAtRestValue(encryptionKey, user.username),
        usernameLookupHash,
        user.displayName,
        user.role,
        passwordHash,
        encryptAtRestValue(encryptionKey, user.externalIdentifier),
      ],
    );

    userIds.set(user.username, result.rows[0]!.id);
  }

  const authorLian = await upsertLookup('authors', 'Lian Sun');
  const authorMarcos = await upsertLookup('authors', 'Marcos Vale');
  const seriesArchive = await upsertLookup('series', 'Archive Atlas');

  const quietHarborDigitalId = await upsertTitle({
    slug: 'quiet-harbor-digital',
    name: 'Quiet Harbor',
    format: 'DIGITAL',
    authorId: authorLian,
    seriesId: seriesArchive,
    priceCents: 1299,
    inventoryOnHand: 999,
    bestsellerRank: 1,
  });

  const midnightLedgerDigitalId = await upsertTitle({
    slug: 'midnight-ledger-digital',
    name: 'Midnight Ledger',
    format: 'DIGITAL',
    authorId: authorMarcos,
    priceCents: 1499,
    inventoryOnHand: 999,
    bestsellerRank: 2,
  });

  const quietHarborPrintId = await upsertTitle({
    slug: 'quiet-harbor-print',
    name: 'Quiet Harbor Hardcover',
    format: 'PHYSICAL',
    authorId: authorLian,
    seriesId: seriesArchive,
    priceCents: 2499,
    inventoryOnHand: 32,
    bestsellerRank: 3,
  });

  const staffHandbookId = await upsertTitle({
    slug: 'staff-handbook',
    name: 'LedgerRead Staff Handbook',
    format: 'BUNDLE',
    authorId: authorMarcos,
    priceCents: 1999,
    inventoryOnHand: 12,
    bestsellerRank: 4,
  });

  await pool.query('DELETE FROM recommendation_traces');
  await pool.query('DELETE FROM recommendation_snapshots');
  await pool.query('DELETE FROM audit_logs');
  await pool.query('DELETE FROM risk_alerts');
  await pool.query('DELETE FROM attendance_records');
  await pool.query('DELETE FROM order_items');
  await pool.query('DELETE FROM orders');
  await pool.query('DELETE FROM cart_items');
  await pool.query('DELETE FROM carts');
  await pool.query('DELETE FROM moderation_actions');
  await pool.query('DELETE FROM reports');
  await pool.query('DELETE FROM comments');
  await pool.query('DELETE FROM user_blocks');
  await pool.query('DELETE FROM user_mutes');
  await pool.query('DELETE FROM favorites');
  await pool.query('DELETE FROM author_subscriptions');
  await pool.query('DELETE FROM series_subscriptions');
  await pool.query('DELETE FROM ratings');
  await pool.query('DELETE FROM sessions');
  await pool.query('DELETE FROM inventory_receipts');
  await pool.query('DELETE FROM reconciliation_discrepancies');
  await pool.query('DELETE FROM supplier_invoice_lines');
  await pool.query('DELETE FROM supplier_invoices');
  await pool.query('DELETE FROM supplier_statement_lines');
  await pool.query('DELETE FROM supplier_statements');
  await pool.query('DELETE FROM discrepancy_flags');
  await pool.query('DELETE FROM supplier_manifest_items');
  await pool.query('DELETE FROM supplier_manifests');
  await pool.query('DELETE FROM payment_plans');
  await pool.query('DELETE FROM bundle_links');

  await pool.query('DELETE FROM chapters');
  const chapterInserts = [
    [quietHarborDigitalId, 1, 'Tide Glass', 'Quiet Harbor opens beside a windswept pier.', '靜港在一座迎風的碼頭旁展開。'],
    [quietHarborDigitalId, 2, 'Paper Lanterns', 'Lantern sellers trade stories before dawn.', '燈籠販子在黎明前交換故事。'],
    [midnightLedgerDigitalId, 1, 'Ink And Copper', 'Every account in the ledger remembers a debt.', '賬簿中的每一筆記錄都記得一筆債。'],
    [midnightLedgerDigitalId, 2, 'False Margin', 'The night clerk hears numbers whisper in the stacks.', '夜班店員聽見書架間的數字低語。'],
  ];

  for (const chapter of chapterInserts) {
    await pool.query(
      `
      INSERT INTO chapters (title_id, chapter_order, name, body_simplified, body_traditional)
      VALUES ($1, $2, $3, $4, $5)
      `,
      chapter,
    );
  }

  const readerAdaId = userIds.get('reader.ada')!;
  const readerMeiId = userIds.get('reader.mei')!;

  await pool.query(
    `
    INSERT INTO reading_profiles (user_id, device_label, preferences, updated_at)
    VALUES ($1, $2, $3::jsonb, $4)
    ON CONFLICT (user_id)
    DO UPDATE SET device_label = EXCLUDED.device_label,
                  preferences = EXCLUDED.preferences,
                  updated_at = EXCLUDED.updated_at
    `,
    [readerAdaId, 'Front Register Tablet', JSON.stringify(defaultReadingPreferences), defaultReadingPreferences.updatedAt],
  );

  await pool.query(
    `
    INSERT INTO reading_profiles (user_id, device_label, preferences, updated_at)
    VALUES ($1, $2, $3::jsonb, $4)
    ON CONFLICT (user_id)
    DO UPDATE SET device_label = EXCLUDED.device_label,
                  preferences = EXCLUDED.preferences,
                  updated_at = EXCLUDED.updated_at
    `,
    [
      readerMeiId,
      'Warehouse Kiosk',
      JSON.stringify({
        ...defaultReadingPreferences,
        nightMode: true,
        chineseMode: 'TRADITIONAL',
        updatedAt: '2026-03-28T08:00:00.000Z',
      }),
      '2026-03-28T08:00:00.000Z',
    ],
  );

  await pool.query('DELETE FROM sensitive_words');
  await pool.query(
    `
    INSERT INTO sensitive_words (word)
    VALUES ('spoiler'), ('counterfeit'), ('abuse')
    ON CONFLICT (word) DO NOTHING
    `,
  );

  const quietHarborDigitalSkuId = await upsertInventoryItem({
    sku: 'SKU-QH-DIGI',
    titleId: quietHarborDigitalId,
    name: 'Quiet Harbor Digital License',
    priceCents: 1299,
    onHand: 999,
    movingAverageCostCents: 400,
    freightCents: 0,
    surchargeCents: 25,
  });

  const quietHarborPrintSkuId = await upsertInventoryItem({
    sku: 'SKU-QH-PRINT',
    titleId: quietHarborPrintId,
    name: 'Quiet Harbor Hardcover',
    priceCents: 2499,
    onHand: 32,
    movingAverageCostCents: 1200,
    freightCents: 125,
    surchargeCents: 35,
  });

  const bookmarkSkuId = await upsertInventoryItem({
    sku: 'SKU-BKMK-01',
    name: 'Archive Atlas Bookmark',
    priceCents: 399,
    onHand: 140,
    movingAverageCostCents: 90,
    freightCents: 20,
    surchargeCents: 10,
  });

  await upsertInventoryItem({
    sku: 'SKU-STAFF-KIT',
    titleId: staffHandbookId,
    name: 'LedgerRead Staff Bundle',
    priceCents: 1999,
    onHand: 12,
    movingAverageCostCents: 1100,
    freightCents: 60,
    surchargeCents: 25,
  });

  await pool.query(
    `
    INSERT INTO bundle_links (inventory_item_id, complementary_item_id)
    VALUES ($1, $2), ($2, $1)
    ON CONFLICT (inventory_item_id, complementary_item_id) DO NOTHING
    `,
    [quietHarborPrintSkuId, bookmarkSkuId],
  );
  const rootComment = await pool.query<{ id: string }>(
    `
    INSERT INTO comments (title_id, user_id, comment_type, body, duplicate_fingerprint)
    VALUES ($1, $2, 'COMMENT', $3, $4)
    RETURNING id
    `,
    [
      quietHarborDigitalId,
      readerMeiId,
      'The chapter pacing feels perfect for late-night reading.',
      'seed:quiet-harbor:comment-1',
    ],
  );

  await pool.query(
    `
    INSERT INTO comments (title_id, user_id, parent_comment_id, comment_type, body, duplicate_fingerprint)
    VALUES ($1, $2, $3, 'QUESTION', $4, $5)
    `,
    [
      quietHarborDigitalId,
      readerAdaId,
      rootComment.rows[0]!.id,
      'Does the print edition include the lantern map insert?',
      'seed:quiet-harbor:comment-2',
    ],
  );

  await pool.query(
    `
    INSERT INTO ratings (user_id, title_id, rating)
    VALUES ($1, $2, 5), ($3, $2, 4)
    ON CONFLICT (user_id, title_id)
    DO UPDATE SET rating = EXCLUDED.rating,
                  updated_at = NOW()
    `,
    [readerAdaId, quietHarborDigitalId, readerMeiId],
  );

  await pool.query(
    `
    INSERT INTO payment_plans (supplier_name, status, note_cipher)
    VALUES ($1, $2, $3), ($4, $5, $6)
    ON CONFLICT DO NOTHING
    `,
    [
      'North Pier Press',
      'PENDING',
      encryptAtRestValue(encryptionKey, 'Awaiting cashier statement batch from shelf restock.'),
      'Amber Finch Wholesale',
      'MATCHED',
      encryptAtRestValue(encryptionKey, 'Invoice and statement aligned in last review.'),
    ],
  );

  await pool.query(
    `
    INSERT INTO rule_versions (rule_key, version, definition)
    VALUES
      ('missing-clock-out', 1, $1::jsonb),
      ('evidence-file-mismatch', 1, $2::jsonb)
    ON CONFLICT DO NOTHING
    `,
    [
      JSON.stringify({ thresholdHours: 12, description: 'Missing clock-out after 12 hours.' }),
      JSON.stringify({ behavior: 'alert', description: 'Evidence file checksum mismatch.' }),
    ],
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
