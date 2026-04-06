import { currency, formatReadableDateTime } from '../../lib/format';
import type { SettlementResponse } from '../../lib/types';

export function DiscrepancyReviewSection({
  canUpdateDiscrepancies,
  discrepancies,
  isPending,
  onUpdateDiscrepancyStatus,
}: {
  canUpdateDiscrepancies?: boolean;
  discrepancies: SettlementResponse['discrepancies'];
  isPending?: (key: string) => boolean;
  onUpdateDiscrepancyStatus?: (
    discrepancyId: string,
    status: SettlementResponse['discrepancies'][number]['status'],
  ) => Promise<void>;
}) {
  if (discrepancies.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 px-4 py-4 font-ui text-sm text-black/60 dark:border-white/10 dark:text-white/60">
        No discrepancy flags are currently open.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {discrepancies.map((item) => (
        <article key={item.id} className="rounded-2xl border border-black/10 px-4 py-4 dark:border-white/10">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="font-ui text-xs uppercase tracking-[0.18em] text-black/45 dark:text-white/45">
                {item.sku}
              </p>
              <h3 className="mt-2 font-display text-2xl">Quantity diff {item.quantity_difference}</h3>
            </div>
            <p className="font-ui text-sm text-black/55 dark:text-white/55">{item.status}</p>
          </div>
          <p className="mt-3 font-ui text-sm text-black/65 dark:text-white/65">
            Amount difference {currency(item.amountDifference)} · Raised {formatReadableDateTime(item.created_at)}
          </p>
          <p className="mt-2 font-ui text-sm text-black/55 dark:text-white/55">
            {item.statement_reference ?? 'No statement ref'} · {item.invoice_reference ?? 'No invoice ref'}
          </p>
          {canUpdateDiscrepancies && onUpdateDiscrepancyStatus && item.allowedTransitions.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {item.allowedTransitions.map((status) => (
                <button
                  key={status}
                  type="button"
                  className="button-secondary"
                  disabled={isPending?.(`discrepancy-${item.id}-${status}`)}
                  onClick={() => void onUpdateDiscrepancyStatus(item.id, status)}
                >
                  Mark {status}
                </button>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
