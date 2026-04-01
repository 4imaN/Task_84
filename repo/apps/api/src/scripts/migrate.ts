import { Pool } from 'pg';
import { versionedMigrations } from '@ledgerread/db';
import {
  createIdentifierLookupHash,
  decryptAtRestValue,
  encryptAtRestValue,
} from '../security/identifier';

const ensureDatabaseExists = async (databaseUrl: string) => {
  const target = new URL(databaseUrl);
  const databaseName = target.pathname.replace(/^\//, '');
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';

  const adminPool = new Pool({
    connectionString: adminUrl.toString(),
  });

  try {
    const exists = await adminPool.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [databaseName],
    );

    if (!exists.rows[0]?.exists) {
      await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await adminPool.end();
  }
};

async function main() {
  const connectionString = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ledgerread';
  const encryptionKey = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!encryptionKey) {
    throw new Error('APP_ENCRYPTION_KEY is required before running migrations.');
  }
  await ensureDatabaseExists(connectionString);

  const pool = new Pool({
    connectionString,
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const appliedVersions = await pool.query<{ version: string }>(
      `
      SELECT version
      FROM schema_migrations
      `,
    );
    const appliedVersionSet = new Set(appliedVersions.rows.map((row) => row.version));
    const pendingMigrations = [...versionedMigrations]
      .sort((left, right) => left.version.localeCompare(right.version))
      .filter((migration) => !appliedVersionSet.has(migration.version));

    for (const migration of pendingMigrations) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const statement of migration.statements) {
          await client.query(statement);
        }
        await client.query(
          `
          INSERT INTO schema_migrations (version)
          VALUES ($1)
          ON CONFLICT (version) DO NOTHING
          `,
          [migration.version],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    const users = await pool.query<{
      id: string;
      username: string | null;
      username_cipher: string | null;
      username_lookup_hash: string | null;
    }>(
      `
      SELECT id, username, username_cipher, username_lookup_hash
      FROM users
      `,
    );

    for (const user of users.rows) {
      const sourceUsername =
        user.username ?? (user.username_cipher ? decryptAtRestValue(encryptionKey, user.username_cipher) : null);

      if (!sourceUsername) {
        continue;
      }

      await pool.query(
        `
        UPDATE users
        SET username = NULL,
            username_cipher = $2,
            username_lookup_hash = $3,
            updated_at = NOW()
        WHERE id = $1
        `,
        [
          user.id,
          encryptAtRestValue(encryptionKey, sourceUsername),
          createIdentifierLookupHash(encryptionKey, sourceUsername),
        ],
      );
    }

    await pool.query(`
      ALTER TABLE users
        ALTER COLUMN username_cipher SET NOT NULL,
        ALTER COLUMN username_lookup_hash SET NOT NULL
    `);
  } finally {
    await pool.end();
  }
}

void main();
