import type { VersionedMigration } from '../index';

export const reconciliationAndCheckoutMigration: VersionedMigration = {
  version: '002_reconciliation_and_checkout',
  statements: [
    `
    ALTER TABLE carts
      ADD COLUMN IF NOT EXISTS review_signature TEXT,
      ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reviewed_total_cents INTEGER,
      ADD COLUMN IF NOT EXISTS review_snapshot JSONB;

    CREATE TABLE IF NOT EXISTS supplier_statements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      uploaded_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      supplier_name TEXT NOT NULL,
      statement_reference TEXT NOT NULL,
      source_filename TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS supplier_statement_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      statement_id UUID NOT NULL REFERENCES supplier_statements(id) ON DELETE CASCADE,
      sku TEXT NOT NULL,
      statement_quantity INTEGER NOT NULL,
      statement_extended_amount_cents INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS supplier_invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      statement_id UUID NOT NULL REFERENCES supplier_statements(id) ON DELETE CASCADE,
      invoice_reference TEXT NOT NULL,
      freight_cents INTEGER NOT NULL DEFAULT 0,
      surcharge_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
      statement_line_id UUID REFERENCES supplier_statement_lines(id) ON DELETE SET NULL,
      sku TEXT NOT NULL,
      invoice_quantity INTEGER NOT NULL,
      invoice_extended_amount_cents INTEGER NOT NULL,
      unit_cost_cents INTEGER NOT NULL,
      landed_cost_allocation_cents INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS inventory_receipts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
      inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      supplier_invoice_line_id UUID NOT NULL REFERENCES supplier_invoice_lines(id) ON DELETE CASCADE,
      quantity_received INTEGER NOT NULL,
      base_cost_cents INTEGER NOT NULL,
      landed_cost_cents INTEGER NOT NULL,
      previous_on_hand INTEGER NOT NULL,
      previous_moving_average_cost_cents INTEGER NOT NULL,
      resulting_on_hand INTEGER NOT NULL,
      resulting_moving_average_cost_cents INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reconciliation_discrepancies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      supplier_statement_id UUID NOT NULL REFERENCES supplier_statements(id) ON DELETE CASCADE,
      supplier_invoice_id UUID NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
      supplier_statement_line_id UUID REFERENCES supplier_statement_lines(id) ON DELETE SET NULL,
      supplier_invoice_line_id UUID REFERENCES supplier_invoice_lines(id) ON DELETE SET NULL,
      sku TEXT NOT NULL,
      quantity_difference INTEGER NOT NULL,
      amount_difference_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE payment_plans
      ADD COLUMN IF NOT EXISTS supplier_statement_id UUID REFERENCES supplier_statements(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS supplier_invoice_id UUID REFERENCES supplier_invoices(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `,
  ],
};
