import type { VersionedMigration } from '../index';

export const domainConstraintsAndUserUpdateGrantsMigration: VersionedMigration = {
  version: '010_domain_constraints_and_user_update_grants',
  statements: [
    `
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerread_app') THEN
        REVOKE UPDATE ON TABLE users FROM ledgerread_app;
        GRANT UPDATE (is_suspended, failed_login_attempts, locked_until, updated_at) ON TABLE users TO ledgerread_app;
      END IF;
    END;
    $$;

    ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('CUSTOMER', 'CLERK', 'MODERATOR', 'MANAGER', 'FINANCE', 'INVENTORY_MANAGER'));

    ALTER TABLE sessions
      DROP CONSTRAINT IF EXISTS sessions_workspace_check;
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_workspace_check
      CHECK (workspace IN ('app', 'pos', 'mod', 'admin', 'finance'));

    ALTER TABLE titles
      DROP CONSTRAINT IF EXISTS titles_format_check;
    ALTER TABLE titles
      ADD CONSTRAINT titles_format_check
      CHECK (format IN ('DIGITAL', 'PHYSICAL', 'BUNDLE'));

    ALTER TABLE comments
      DROP CONSTRAINT IF EXISTS comments_comment_type_check;
    ALTER TABLE comments
      ADD CONSTRAINT comments_comment_type_check
      CHECK (comment_type IN ('COMMENT', 'QUESTION'));

    ALTER TABLE reports
      DROP CONSTRAINT IF EXISTS reports_status_check;
    ALTER TABLE reports
      ADD CONSTRAINT reports_status_check
      CHECK (status IN ('OPEN', 'RESOLVED'));

    ALTER TABLE moderation_actions
      DROP CONSTRAINT IF EXISTS moderation_actions_action_check;
    ALTER TABLE moderation_actions
      ADD CONSTRAINT moderation_actions_action_check
      CHECK (action IN ('hide', 'restore', 'remove', 'suspend'));

    ALTER TABLE carts
      DROP CONSTRAINT IF EXISTS carts_status_check;
    ALTER TABLE carts
      ADD CONSTRAINT carts_status_check
      CHECK (status IN ('OPEN', 'CHECKED_OUT'));

    ALTER TABLE orders
      DROP CONSTRAINT IF EXISTS orders_payment_method_check;
    ALTER TABLE orders
      ADD CONSTRAINT orders_payment_method_check
      CHECK (payment_method IN ('CASH', 'EXTERNAL_TERMINAL'));
    `,
  ],
};
