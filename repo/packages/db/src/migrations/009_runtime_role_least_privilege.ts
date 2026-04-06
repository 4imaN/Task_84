import type { VersionedMigration } from '../index';

export const runtimeRoleLeastPrivilegeMigration: VersionedMigration = {
  version: '009_runtime_role_least_privilege',
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

        GRANT SELECT ON TABLE users TO ledgerread_app;
        GRANT UPDATE (is_suspended, failed_login_attempts, locked_until, updated_at) ON TABLE users TO ledgerread_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sessions TO ledgerread_app;

        GRANT SELECT ON TABLE authors,
                           series,
                           titles,
                           chapters,
                           sensitive_words,
                           bundle_links,
                           rule_versions TO ledgerread_app;

        GRANT SELECT, INSERT, UPDATE ON TABLE reading_profiles TO ledgerread_app;
        GRANT SELECT, INSERT, UPDATE ON TABLE ratings TO ledgerread_app;
        GRANT SELECT, INSERT, DELETE ON TABLE favorites,
                                           author_subscriptions,
                                           series_subscriptions,
                                           user_blocks,
                                           user_mutes TO ledgerread_app;
        GRANT SELECT, INSERT, UPDATE ON TABLE comments,
                                           reports TO ledgerread_app;
        GRANT SELECT, INSERT ON TABLE moderation_actions TO ledgerread_app;

        GRANT SELECT, UPDATE ON TABLE inventory_items TO ledgerread_app;
        GRANT SELECT, INSERT, UPDATE ON TABLE carts TO ledgerread_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cart_items TO ledgerread_app;
        GRANT SELECT, INSERT ON TABLE orders,
                                  order_items TO ledgerread_app;

        GRANT SELECT, INSERT ON TABLE supplier_statements,
                                  supplier_statement_lines,
                                  supplier_invoices,
                                  supplier_invoice_lines,
                                  inventory_receipts TO ledgerread_app;
        GRANT SELECT, INSERT, UPDATE ON TABLE reconciliation_discrepancies,
                                           payment_plans TO ledgerread_app;

        GRANT SELECT, INSERT ON TABLE audit_logs,
                                  attendance_records,
                                  risk_alerts TO ledgerread_app;
        GRANT SELECT, INSERT, UPDATE ON TABLE recommendation_snapshots TO ledgerread_app;
        GRANT INSERT ON TABLE recommendation_traces TO ledgerread_app;

        REVOKE ALL ON TABLE schema_migrations FROM ledgerread_app;
        IF to_regclass('public.seed_metadata') IS NOT NULL THEN
          EXECUTE 'REVOKE ALL ON TABLE seed_metadata FROM ledgerread_app';
        END IF;

        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ledgerread_app;

        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          REVOKE ALL ON TABLES FROM ledgerread_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public
          REVOKE ALL ON SEQUENCES FROM ledgerread_app;
      END IF;
    END;
    $$;
    `,
  ],
};
