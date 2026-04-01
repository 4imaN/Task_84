import { Metric } from '../common/Metric';
import { currency } from '../../lib/format';
import type { CartSummary } from '../../lib/types';

type PosReviewPanelProps = {
  summary: CartSummary | null;
  stockIssueBySku: Map<string, CartSummary['stockIssues'][number]>;
  lineQuantities: Record<string, string>;
  onLineQuantityChange: (cartItemId: string, value: string) => void;
  onLineQuantityBlur: (cartItemId: string, currentQuantity: number) => Promise<void>;
  onDecrease: (cartItemId: string, quantity: number) => void;
  onIncrease: (cartItemId: string, quantity: number) => void;
  onRemove: (cartItemId: string) => void;
  isPending: (key: string) => boolean;
};

export function PosReviewPanel({
  summary,
  stockIssueBySku,
  lineQuantities,
  onLineQuantityChange,
  onLineQuantityBlur,
  onDecrease,
  onIncrease,
  onRemove,
  isPending,
}: PosReviewPanelProps) {
  return (
    <section className="shell-panel p-6">
      <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">Review Panel</p>
      {summary ? (
        <div className="mt-5 space-y-4">
          {summary.stockIssues.length > 0 ? (
            <div className="rounded-3xl border border-[#f59e0b]/40 bg-[#f59e0b]/12 px-4 py-4">
              <p className="font-ui text-xs uppercase tracking-[0.2em] text-[#9a3412] dark:text-[#f6ad75]">
                Blocking Inventory Issues
              </p>
              <div className="mt-3 space-y-2 font-ui text-sm text-[#7c2d12] dark:text-[#f8d7a7]">
                {summary.stockIssues.map((issue) => (
                  <p key={issue.sku}>
                    {issue.sku}: requested {issue.requestedQuantity}, available {issue.availableQuantity}.
                  </p>
                ))}
              </div>
            </div>
          ) : null}
          {summary.items.map((item) => (
            <div key={item.cartItemId} className="rounded-2xl border border-black/10 px-4 py-3 dark:border-white/10">
              {stockIssueBySku.get(item.sku) ? (
                <div className="mb-4 rounded-2xl border border-[#f59e0b]/40 bg-[#f59e0b]/12 px-4 py-3">
                  <p className="font-ui text-xs uppercase tracking-[0.18em] text-[#9a3412] dark:text-[#f6ad75]">
                    Stock issue
                  </p>
                  <p className="mt-2 font-ui text-sm text-[#7c2d12] dark:text-[#f8d7a7]">
                    Only {stockIssueBySku.get(item.sku)?.availableQuantity} units are available for {item.sku}. Lower the quantity from {stockIssueBySku.get(item.sku)?.requestedQuantity} to continue.
                  </p>
                </div>
              ) : null}
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <span>
                  <span className="block font-display text-2xl">{item.name}</span>
                  <span className="font-ui text-sm text-black/55 dark:text-white/55">
                    {item.sku} · qty {item.quantity} · {item.onHand} on hand
                  </span>
                </span>
                <span className="font-ui text-sm">{currency(item.unitPrice)}</span>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  aria-label={`Decrease quantity for ${item.name}`}
                  className="button-secondary pos-icon-button"
                  disabled={isPending(`pos-update-line-${item.cartItemId}`)}
                  onClick={() => onDecrease(item.cartItemId, item.quantity)}
                  type="button"
                >
                  -
                </button>
                <input
                  aria-label={`Quantity for ${item.name}`}
                  className="field pos-line-quantity-field"
                  disabled={isPending(`pos-update-line-${item.cartItemId}`)}
                  min={1}
                  type="number"
                  value={lineQuantities[item.cartItemId] ?? String(item.quantity)}
                  onChange={(event) => onLineQuantityChange(item.cartItemId, event.target.value)}
                  onBlur={() => {
                    void onLineQuantityBlur(item.cartItemId, item.quantity);
                  }}
                />
                <button
                  aria-label={`Increase quantity for ${item.name}`}
                  className="button-secondary pos-icon-button"
                  disabled={isPending(`pos-update-line-${item.cartItemId}`)}
                  onClick={() => onIncrease(item.cartItemId, item.quantity)}
                  type="button"
                >
                  +
                </button>
                <button
                  className="button-secondary pos-inline-button"
                  disabled={isPending(`pos-remove-line-${item.cartItemId}`)}
                  onClick={() => onRemove(item.cartItemId)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <div className="grid gap-3 md:grid-cols-3">
            <Metric label="Subtotal" value={currency(summary.subtotal)} />
            <Metric label="Discounts" value={currency(summary.discount)} />
            <Metric label="Fees" value={currency(summary.fees)} />
          </div>
          <Metric label="Review Total" value={currency(summary.total)} accent />
          {summary.suggestions.length > 0 ? (
            <div className="rounded-3xl border border-brass/30 bg-brass/10 p-4">
              <p className="font-ui text-xs uppercase tracking-[0.2em] text-black/45 dark:text-white/45">
                Bundle Prompt
              </p>
              <p className="mt-3 font-display text-2xl">
                Complementary item available: {summary.suggestions.map((item) => item.name).join(', ')}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-5 rounded-3xl border border-dashed border-black/10 p-6 font-ui text-sm text-black/55 dark:border-white/10 dark:text-white/55">
          Build a cart and run review total to see stock validation, discounts, fee allocation, and bundle prompts.
        </div>
      )}
    </section>
  );
}
