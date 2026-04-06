import type { VersionedMigration } from '../index';

export const ruleVersionsUniquenessMigration: VersionedMigration = {
  version: '007_rule_versions_uniqueness',
  statements: [
    `
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY rule_key, version
               ORDER BY created_at DESC, id DESC
             ) AS row_rank
      FROM rule_versions
    )
    DELETE FROM rule_versions
    USING ranked
    WHERE rule_versions.id = ranked.id
      AND ranked.row_rank > 1;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'rule_versions_rule_key_version_key'
          AND conrelid = 'rule_versions'::regclass
      ) THEN
        ALTER TABLE rule_versions
          ADD CONSTRAINT rule_versions_rule_key_version_key
          UNIQUE (rule_key, version);
      END IF;
    END;
    $$;
    `,
  ],
};
