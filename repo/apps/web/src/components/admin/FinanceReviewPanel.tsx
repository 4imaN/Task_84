import { Link } from 'react-router-dom';
import { DiscrepancyReviewSection } from './DiscrepancyReviewSection';
import { QueryBoundary } from '../common/QueryBoundary';
import { currency, formatReadableDateTime } from '../../lib/format';
import type { SettlementResponse } from '../../lib/types';

type FinanceReviewPanelProps = {
  auditPath: string;
  settlements: {
    data: SettlementResponse | undefined;
    isPending: boolean;
    isError: boolean;
    refetch: () => Promise<unknown>;
  };
};

export function FinanceReviewPanel({ auditPath, settlements }: FinanceReviewPanelProps) {
  return (
    <section className="shell-panel min-w-0 w-full p-6">
      <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">
        Reconciliation Review
      </p>
      <p className="mt-3 font-ui text-sm text-black/60 dark:text-white/60">
        Finance and inventory staff share this review surface for settlement status, discrepancy flags, and audit access.
      </p>
      <div className="mt-5">
        <QueryBoundary
          isPending={settlements.isPending}
          isError={settlements.isError}
          isEmpty={
            (settlements.data?.paymentPlans.length ?? 0) === 0 &&
            (settlements.data?.discrepancies.length ?? 0) === 0
          }
          emptyTitle="No Reconciliation Activity"
          emptyMessage="No supplier settlement or discrepancy records are currently available."
          errorMessage="Reconciliation data could not be loaded."
          onRetry={() => void settlements.refetch()}
          loading={<div className="skeleton h-64" />}
        >
          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="font-ui text-xs uppercase tracking-[0.22em] text-black/45 dark:text-white/45">
                  Settlement Status
                </p>
                <span className="font-ui text-xs uppercase tracking-[0.18em] text-black/45 dark:text-white/45">
                  {(settlements.data?.paymentPlans.length ?? 0)} plans
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {(settlements.data?.paymentPlans ?? []).length > 0 ? (
                  (settlements.data?.paymentPlans ?? []).map((plan) => (
                    <div key={plan.id} className="rounded-2xl border border-black/10 px-4 py-3 dark:border-white/10">
                      <p className="font-display text-2xl">{plan.supplier_name}</p>
                      <p className="mt-2 font-ui text-sm text-black/55 dark:text-white/55">
                        {plan.status} · {formatReadableDateTime(plan.created_at)}
                      </p>
                      <p className="mt-2 font-ui text-sm text-black/55 dark:text-white/55">
                        {plan.statement_reference ?? 'No statement ref'} · {plan.invoice_reference ?? 'No invoice ref'}
                      </p>
                      <p className="mt-2 font-ui text-sm text-black/55 dark:text-white/55">
                        Invoice {currency(plan.invoiceAmount ?? 0)} · Landed Cost {currency(plan.landedCost ?? 0)}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-black/10 px-4 py-4 font-ui text-sm text-black/60 dark:border-white/10 dark:text-white/60">
                    No settlement plans are currently available.
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-black/10 pt-5 dark:border-white/10">
              <div className="flex items-center justify-between gap-3">
                <p className="font-ui text-xs uppercase tracking-[0.22em] text-black/45 dark:text-white/45">
                  Discrepancy Review
                </p>
                <span className="font-ui text-xs uppercase tracking-[0.18em] text-black/45 dark:text-white/45">
                  {(settlements.data?.discrepancies.length ?? 0)} flags
                </span>
              </div>
              <div className="mt-4">
                <DiscrepancyReviewSection discrepancies={settlements.data?.discrepancies ?? []} />
              </div>
            </div>

            <div className="rounded-3xl border border-brass/30 bg-brass/10 px-4 py-4">
              <p className="font-ui text-xs uppercase tracking-[0.2em] text-black/45 dark:text-white/45">
                Audit Trail
              </p>
              <p className="mt-2 font-ui text-sm text-black/70 dark:text-white/70">
                Open the immutable audit stream for reconciliation imports, valuation changes, and settlement actions.
              </p>
              <Link className="button-secondary mt-4 inline-flex" to={auditPath}>
                Open Audit Trail
              </Link>
            </div>
          </div>
        </QueryBoundary>
      </div>
    </section>
  );
}
