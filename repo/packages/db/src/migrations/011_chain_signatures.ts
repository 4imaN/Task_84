import type { VersionedMigration } from '../index';

export const chainSignaturesMigration: VersionedMigration = {
  version: '011_chain_signatures',
  statements: [
    `
    ALTER TABLE audit_logs
      ADD COLUMN IF NOT EXISTS chain_signature TEXT;

    ALTER TABLE attendance_records
      ADD COLUMN IF NOT EXISTS chain_signature TEXT;

    CREATE OR REPLACE FUNCTION enforce_chain_signature_on_insert()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.chain_signature IS NULL OR NEW.chain_signature !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION '% requires a valid chain_signature', TG_TABLE_NAME;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS audit_logs_require_chain_signature ON audit_logs;
    CREATE TRIGGER audit_logs_require_chain_signature
      BEFORE INSERT ON audit_logs
      FOR EACH ROW
      EXECUTE FUNCTION enforce_chain_signature_on_insert();

    DROP TRIGGER IF EXISTS attendance_records_require_chain_signature ON attendance_records;
    CREATE TRIGGER attendance_records_require_chain_signature
      BEFORE INSERT ON attendance_records
      FOR EACH ROW
      EXECUTE FUNCTION enforce_chain_signature_on_insert();
    `,
  ],
};
