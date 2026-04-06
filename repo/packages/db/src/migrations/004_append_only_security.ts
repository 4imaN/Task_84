import type { VersionedMigration } from '../index';

export const appendOnlySecurityMigration: VersionedMigration = {
  version: '004_append_only_security',
  statements: [
    `
    CREATE OR REPLACE FUNCTION ledgerread_reject_append_only_change()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only and does not allow % operations.', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '55000';
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS audit_logs_reject_update ON audit_logs;
    CREATE TRIGGER audit_logs_reject_update
      BEFORE UPDATE ON audit_logs
      FOR EACH ROW
      EXECUTE FUNCTION ledgerread_reject_append_only_change();

    DROP TRIGGER IF EXISTS audit_logs_reject_delete ON audit_logs;
    CREATE TRIGGER audit_logs_reject_delete
      BEFORE DELETE ON audit_logs
      FOR EACH ROW
      EXECUTE FUNCTION ledgerread_reject_append_only_change();

    DROP TRIGGER IF EXISTS attendance_records_reject_update ON attendance_records;
    CREATE TRIGGER attendance_records_reject_update
      BEFORE UPDATE ON attendance_records
      FOR EACH ROW
      EXECUTE FUNCTION ledgerread_reject_append_only_change();

    DROP TRIGGER IF EXISTS attendance_records_reject_delete ON attendance_records;
    CREATE TRIGGER attendance_records_reject_delete
      BEFORE DELETE ON attendance_records
      FOR EACH ROW
      EXECUTE FUNCTION ledgerread_reject_append_only_change();

    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerread_app') THEN
        GRANT SELECT, INSERT ON audit_logs, attendance_records TO ledgerread_app;
        REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, attendance_records FROM ledgerread_app;
      END IF;
    END;
    $$;
    `,
  ],
};
