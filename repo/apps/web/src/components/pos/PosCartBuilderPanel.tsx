import { currency } from '../../lib/format';
import type { CartSummary, InventorySuggestion, PaymentMethod } from '../../lib/types';

type PosCartBuilderPanelProps = {
  sku: string;
  onSkuChange: (value: string) => void;
  quantity: number;
  onQuantityChange: (value: number) => void;
  inventorySuggestions: InventorySuggestion[];
  suggestedItem: InventorySuggestion | null;
  onSelectSuggestion: (sku: string) => void;
  onAddItem: () => void;
  onReviewTotal: () => void;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (value: PaymentMethod) => void;
  paymentNote: string;
  onPaymentNoteChange: (value: string) => void;
  onCheckout: () => void;
  cartId: string | null;
  summary: CartSummary | null;
  isPending: (key: string) => boolean;
};

export function PosCartBuilderPanel({
  sku,
  onSkuChange,
  quantity,
  onQuantityChange,
  inventorySuggestions,
  suggestedItem,
  onSelectSuggestion,
  onAddItem,
  onReviewTotal,
  paymentMethod,
  onPaymentMethodChange,
  paymentNote,
  onPaymentNoteChange,
  onCheckout,
  cartId,
  summary,
  isPending,
}: PosCartBuilderPanelProps) {
  return (
    <section className="shell-panel p-6">
      <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">Cart Builder</p>
      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_108px]">
        <div className="space-y-3">
          <input
            className="field"
            placeholder="Start typing a SKU or title"
            value={sku}
            onChange={(event) => onSkuChange(event.target.value.toUpperCase())}
          />
          <div className="overflow-hidden rounded-3xl border border-black/10 dark:border-white/10">
            {inventorySuggestions.slice(0, 5).map((item) => (
              <button
                key={item.sku}
                className="flex w-full items-center justify-between gap-4 border-b border-black/10 px-4 py-3 text-left transition last:border-b-0 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
                onClick={() => onSelectSuggestion(item.sku)}
                type="button"
              >
                <span>
                  <span className="block font-display text-xl">{item.name}</span>
                  <span className="font-ui text-xs uppercase tracking-[0.18em] text-black/45 dark:text-white/45">
                    {item.sku}
                    {item.titleName ? ` · ${item.titleName}` : ''}
                  </span>
                </span>
                <span className="font-ui text-sm text-black/55 dark:text-white/55">{item.onHand} in stock</span>
              </button>
            ))}
            {inventorySuggestions.length === 0 ? (
              <div className="px-4 py-3 font-ui text-sm text-black/55 dark:text-white/55">
                Start typing a few letters to filter inventory.
              </div>
            ) : null}
          </div>
        </div>
        <input
          className="field pos-cart-quantity-field"
          type="number"
          min={1}
          value={quantity}
          onChange={(event) => onQuantityChange(Number(event.target.value))}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-start gap-3">
        <button
          className="button-primary pos-action-button"
          disabled={isPending('pos-add-item')}
          onClick={onAddItem}
          type="button"
        >
          {isPending('pos-add-item') ? 'Adding...' : 'Add SKU'}
        </button>
        <button
          className="button-secondary pos-action-button"
          disabled={isPending('pos-review-total')}
          onClick={onReviewTotal}
          type="button"
        >
          {isPending('pos-review-total') ? 'Reviewing...' : 'Review Total'}
        </button>
      </div>

      {suggestedItem ? (
        <div className="mt-5 rounded-3xl border border-black/10 bg-black/5 px-4 py-4 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-display text-2xl">{suggestedItem.name}</p>
              <p className="mt-1 font-ui text-sm text-black/55 dark:text-white/55">
                {suggestedItem.sku}
                {suggestedItem.format ? ` · ${suggestedItem.format}` : ''}
              </p>
            </div>
            <div className="text-right font-ui text-sm">
              <p>{currency(suggestedItem.price)}</p>
              <p className="mt-1 text-black/55 dark:text-white/55">{suggestedItem.onHand} available</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-8 border-t border-black/10 pt-6 dark:border-white/10">
        <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">Checkout</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <select
            className="field"
            value={paymentMethod}
            onChange={(event) => onPaymentMethodChange(event.target.value as PaymentMethod)}
          >
            <option value="CASH">Cash</option>
            <option value="EXTERNAL_TERMINAL">External Terminal</option>
          </select>
          <input className="field" value={paymentNote} onChange={(event) => onPaymentNoteChange(event.target.value)} />
        </div>
        <button
          className="button-primary pos-checkout-button mt-4"
          onClick={onCheckout}
          disabled={
            !cartId ||
            !summary?.reviewReady ||
            (summary?.stockIssues.length ?? 0) > 0 ||
            isPending('pos-checkout')
          }
          type="button"
        >
          {isPending('pos-checkout') ? 'Finalizing...' : 'Finalize Checkout'}
        </button>
        {(summary?.stockIssues.length ?? 0) > 0 ? (
          <p className="mt-3 font-ui text-xs uppercase tracking-[0.16em] text-[#9a3412] dark:text-[#f6ad75]">
            Inventory blockers are active. Reduce the affected line items before checkout can continue.
          </p>
        ) : !summary?.reviewReady ? (
          <p className="mt-3 font-ui text-xs uppercase tracking-[0.16em] text-black/45 dark:text-white/45">
            Review total must succeed before checkout is unlocked.
          </p>
        ) : null}
      </div>
    </section>
  );
}
