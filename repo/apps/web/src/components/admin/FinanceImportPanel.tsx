import { Link } from 'react-router-dom';
import { Metric } from '../common/Metric';
import type { ManifestLineItem, PaymentPlanStatus } from '../../lib/types';
import { currency } from '../../lib/format';

type FinanceImportPanelProps = {
  auditPath: string;
  canImportManifest: boolean;
  freightAmount: number;
  invoiceReference: string;
  isImporting: boolean;
  items: ManifestLineItem[];
  metrics: {
    visiblePlanCount: number;
    statementUnits: number;
    invoiceUnits: number;
    statementAmount: number;
    invoiceAmount: number;
    openDiscrepancyCount: number;
    disputedPlanCount: number;
  };
  paymentPlanStatus: PaymentPlanStatus;
  sourceFilename: string;
  statementReference: string;
  supplierName: string;
  surchargeAmount: number;
  onAddRow: () => void;
  onImport: () => void;
  onRemoveRow: (index: number) => void;
  onUpdateItem: (index: number, key: keyof ManifestLineItem, value: string | number) => void;
  onChangeSupplierName: (value: string) => void;
  onChangeSourceFilename: (value: string) => void;
  onChangeStatementReference: (value: string) => void;
  onChangeInvoiceReference: (value: string) => void;
  onChangeFreightAmount: (value: number) => void;
  onChangeSurchargeAmount: (value: number) => void;
  onChangePaymentPlanStatus: (value: PaymentPlanStatus) => void;
};

export function FinanceImportPanel({
  auditPath,
  canImportManifest,
  freightAmount,
  invoiceReference,
  isImporting,
  items,
  metrics,
  paymentPlanStatus,
  sourceFilename,
  statementReference,
  supplierName,
  surchargeAmount,
  onAddRow,
  onImport,
  onRemoveRow,
  onUpdateItem,
  onChangeSupplierName,
  onChangeSourceFilename,
  onChangeStatementReference,
  onChangeInvoiceReference,
  onChangeFreightAmount,
  onChangeSurchargeAmount,
  onChangePaymentPlanStatus,
}: FinanceImportPanelProps) {
  if (!canImportManifest) {
    return (
      <section className="shell-panel min-w-0 w-full p-6">
        <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">
          Settlement Intake
        </p>
        <p className="mt-3 font-ui text-sm text-black/60 dark:text-white/60">
          Finance reviewers can inspect settlement status, discrepancy flags, and linked audit trails here. Supplier
          statement imports stay restricted to manager and inventory workspaces.
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <Metric label="Visible Plans" value={String(metrics.visiblePlanCount)} />
          <Metric label="Open Flags" value={String(metrics.openDiscrepancyCount)} />
          <Metric label="Disputed Plans" value={String(metrics.disputedPlanCount)} />
        </div>
        <div className="mt-3 rounded-3xl border border-black/10 bg-white/55 px-4 py-4 dark:border-white/10 dark:bg-white/5">
          <p className="font-ui text-xs uppercase tracking-[0.2em] text-black/45 dark:text-white/45">
            Import Governance
          </p>
          <p className="mt-2 font-ui text-sm text-black/70 dark:text-white/70">
            Manifest creation and landed-cost imports are intentionally blocked in the finance workspace. Reviewers stay
            focused on settlement status, discrepancy escalation, and audit follow-through while operations staff own the
            import step inside the manager and inventory consoles.
          </p>
          <Link className="button-secondary mt-4 inline-flex" to={auditPath}>
            Open Audit Trail
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="shell-panel min-w-0 w-full p-6">
      <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">
        Import Manifest
      </p>
      <p className="mt-3 font-ui text-sm text-black/60 dark:text-white/60">
        Build the supplier manifest row by row, then import and compare against local stock and amount thresholds.
      </p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <input className="field" value={supplierName} onChange={(event) => onChangeSupplierName(event.target.value)} />
        <input className="field" value={sourceFilename} onChange={(event) => onChangeSourceFilename(event.target.value)} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <input className="field" value={statementReference} onChange={(event) => onChangeStatementReference(event.target.value)} />
        <input className="field" value={invoiceReference} onChange={(event) => onChangeInvoiceReference(event.target.value)} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <input
          className="field"
          min={0}
          step={0.01}
          type="number"
          value={freightAmount}
          onChange={(event) => onChangeFreightAmount(Number(event.target.value))}
        />
        <input
          className="field"
          min={0}
          step={0.01}
          type="number"
          value={surchargeAmount}
          onChange={(event) => onChangeSurchargeAmount(Number(event.target.value))}
        />
        <select
          className="field"
          value={paymentPlanStatus}
          onChange={(event) => onChangePaymentPlanStatus(event.target.value as PaymentPlanStatus)}
        >
          <option value="PENDING">Pending</option>
          <option value="MATCHED">Matched</option>
          <option value="PARTIAL">Partial</option>
          <option value="PAID">Paid</option>
          <option value="DISPUTED">Disputed</option>
        </select>
      </div>

      <div className="mt-5 space-y-3">
        {items.map((item, index) => (
          <div key={`${item.sku}-${index}`} className="rounded-3xl border border-black/10 p-4 dark:border-white/10">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="space-y-2">
                <span className="font-ui text-[11px] uppercase tracking-[0.18em] text-black/45 dark:text-white/45">
                  SKU
                </span>
                <input
                  aria-label={`SKU for manifest row ${index + 1}`}
                  className="field"
                  placeholder="SKU"
                  value={item.sku}
                  onChange={(event) => onUpdateItem(index, 'sku', event.target.value)}
                />
              </label>
              <label className="space-y-2">
                <span className="font-ui text-[11px] uppercase tracking-[0.18em] text-black/45 dark:text-white/45">
                  Statement Qty
                </span>
                <input
                  aria-label={`Statement quantity for manifest row ${index + 1}`}
                  className="field"
                  min={0}
                  type="number"
                  value={item.statementQuantity}
                  onChange={(event) => onUpdateItem(index, 'statementQuantity', event.target.value)}
                />
              </label>
              <label className="space-y-2">
                <span className="font-ui text-[11px] uppercase tracking-[0.18em] text-black/45 dark:text-white/45">
                  Invoice Qty
                </span>
                <input
                  aria-label={`Invoice quantity for manifest row ${index + 1}`}
                  className="field"
                  min={0}
                  type="number"
                  value={item.invoiceQuantity}
                  onChange={(event) => onUpdateItem(index, 'invoiceQuantity', event.target.value)}
                />
              </label>
              <label className="space-y-2">
                <span className="font-ui text-[11px] uppercase tracking-[0.18em] text-black/45 dark:text-white/45">
                  Statement Amount
                </span>
                <input
                  aria-label={`Statement amount for manifest row ${index + 1}`}
                  className="field"
                  min={0}
                  step={0.01}
                  type="number"
                  value={item.statementExtendedAmount}
                  onChange={(event) => onUpdateItem(index, 'statementExtendedAmount', event.target.value)}
                />
              </label>
              <label className="space-y-2">
                <span className="font-ui text-[11px] uppercase tracking-[0.18em] text-black/45 dark:text-white/45">
                  Invoice Amount
                </span>
                <input
                  aria-label={`Invoice amount for manifest row ${index + 1}`}
                  className="field"
                  min={0}
                  step={0.01}
                  type="number"
                  value={item.invoiceExtendedAmount}
                  onChange={(event) => onUpdateItem(index, 'invoiceExtendedAmount', event.target.value)}
                />
              </label>
              <div className="flex items-end justify-start xl:justify-end">
                <button className="button-secondary" onClick={() => onRemoveRow(index)} type="button">
                  Remove Row
                </button>
              </div>
            </div>
            <div className="mt-4 font-ui text-xs uppercase tracking-[0.16em] text-black/45 dark:text-white/45">
              Blank rows stay local until a SKU is entered, then they count toward the next import.
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Metric label="Qty Diff" value={String(Math.abs(item.statementQuantity - item.invoiceQuantity))} />
              <Metric
                label="Amount Diff"
                value={currency(Math.abs(item.statementExtendedAmount - item.invoiceExtendedAmount))}
              />
              <Metric label="Statement" value={currency(item.statementExtendedAmount)} />
              <Metric label="Invoice" value={currency(item.invoiceExtendedAmount)} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button className="button-secondary" onClick={onAddRow} type="button">
          Add Row
        </button>
        <button className="button-primary" disabled={isImporting} onClick={onImport}>
          {isImporting ? 'Importing...' : 'Import & Compare'}
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <Metric label="Rows" value={String(items.length)} />
        <Metric label="Statement Units" value={String(metrics.statementUnits)} />
        <Metric label="Invoice Units" value={String(metrics.invoiceUnits)} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Metric label="Statement Total" value={currency(metrics.statementAmount)} />
        <Metric label="Invoice Total" value={currency(metrics.invoiceAmount)} />
        <Metric label="Landed Adders" value={currency(freightAmount + surchargeAmount)} />
      </div>

      <div className="mt-5 rounded-3xl border border-brass/30 bg-brass/10 px-4 py-4">
        <p className="font-ui text-xs uppercase tracking-[0.2em] text-black/45 dark:text-white/45">Auto Flags</p>
        <p className="mt-2 font-ui text-sm text-black/70 dark:text-white/70">
          Imports match statement rows to invoice rows, allocate freight and surcharges into landed cost, update
          moving-average valuation, and raise flags when quantity differs by 2+ units or the extended amount differs by
          more than $5.00.
        </p>
      </div>
    </section>
  );
}
