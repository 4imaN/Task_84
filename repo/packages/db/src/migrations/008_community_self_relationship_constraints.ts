import type { VersionedMigration } from '../index';

export const communitySelfRelationshipConstraintsMigration: VersionedMigration = {
  version: '008_community_self_relationship_constraints',
  statements: [
    `
    DELETE FROM user_blocks
    WHERE blocker_user_id = blocked_user_id;

    DELETE FROM user_mutes
    WHERE muter_user_id = muted_user_id;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_blocks_no_self_target'
          AND conrelid = 'user_blocks'::regclass
      ) THEN
        ALTER TABLE user_blocks
          ADD CONSTRAINT user_blocks_no_self_target
          CHECK (blocker_user_id <> blocked_user_id);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_mutes_no_self_target'
          AND conrelid = 'user_mutes'::regclass
      ) THEN
        ALTER TABLE user_mutes
          ADD CONSTRAINT user_mutes_no_self_target
          CHECK (muter_user_id <> muted_user_id);
      END IF;
    END;
    $$;
    `,
  ],
};
