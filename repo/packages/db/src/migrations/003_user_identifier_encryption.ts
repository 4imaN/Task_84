import type { VersionedMigration } from '../index';

export const userIdentifierEncryptionMigration: VersionedMigration = {
  version: '003_user_identifier_encryption',
  statements: [
    `
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS username_cipher TEXT,
      ADD COLUMN IF NOT EXISTS username_lookup_hash TEXT;

    ALTER TABLE users
      ALTER COLUMN username DROP NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lookup_hash_idx
      ON users(username_lookup_hash);
    `,
  ],
};
