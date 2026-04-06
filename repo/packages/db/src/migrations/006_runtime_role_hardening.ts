import type { VersionedMigration } from '../index';

export const runtimeRoleHardeningMigration: VersionedMigration = {
  version: '006_runtime_role_hardening',
  statements: [
    `
    DO $$
    DECLARE
      database_name text := current_database();
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerread_app') THEN
        EXECUTE format('REVOKE ALL ON DATABASE %I FROM ledgerread_app', database_name);
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO ledgerread_app', database_name);

        GRANT USAGE ON SCHEMA public TO ledgerread_app;
        REVOKE CREATE ON SCHEMA public FROM ledgerread_app;

        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ledgerread_app;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ledgerread_app;

        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ledgerread_app;
      END IF;
    END;
    $$;
    `,
  ],
};
