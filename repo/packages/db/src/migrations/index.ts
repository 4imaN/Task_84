import type { VersionedMigration } from '../index';
import { initialSchemaMigration } from './001_initial_schema';
import { reconciliationAndCheckoutMigration } from './002_reconciliation_and_checkout';
import { userIdentifierEncryptionMigration } from './003_user_identifier_encryption';

export const versionedMigrations: VersionedMigration[] = [
  initialSchemaMigration,
  reconciliationAndCheckoutMigration,
  userIdentifierEncryptionMigration,
];
