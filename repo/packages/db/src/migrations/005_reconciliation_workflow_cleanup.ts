import type { VersionedMigration } from '../index';

export const reconciliationWorkflowCleanupMigration: VersionedMigration = {
  version: '005_reconciliation_workflow_cleanup',
  statements: [
    `
    ALTER TABLE payment_plans
      DROP CONSTRAINT IF EXISTS payment_plans_status_check;

    ALTER TABLE payment_plans
      ADD CONSTRAINT payment_plans_status_check
      CHECK (status IN ('PENDING', 'MATCHED', 'PARTIAL', 'PAID', 'DISPUTED'));

    ALTER TABLE reconciliation_discrepancies
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    UPDATE reconciliation_discrepancies
    SET updated_at = created_at
    WHERE updated_at IS NULL;

    ALTER TABLE reconciliation_discrepancies
      DROP CONSTRAINT IF EXISTS reconciliation_discrepancies_status_check;

    ALTER TABLE reconciliation_discrepancies
      ADD CONSTRAINT reconciliation_discrepancies_status_check
      CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'WAIVED'));

    ALTER TABLE risk_alerts
      ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

    UPDATE risk_alerts
    SET user_id = attendance_records.user_id
    FROM attendance_records
    WHERE risk_alerts.attendance_record_id = attendance_records.id
      AND risk_alerts.user_id IS NULL;

    DROP TABLE IF EXISTS discrepancy_flags;
    DROP TABLE IF EXISTS supplier_manifest_items;
    DROP TABLE IF EXISTS supplier_manifests;
    `,
  ],
};
