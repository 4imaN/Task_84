import { PosCartBuilderPanel } from '../../components/pos/PosCartBuilderPanel';
import { PosReviewPanel } from '../../components/pos/PosReviewPanel';
import { usePosWorkflow } from '../../hooks/usePosWorkflow';

export function PosPage() {
  const workflow = usePosWorkflow();

  return (
    <div className="grid gap-5 xl:grid-cols-[0.4fr_0.6fr]">
      <PosCartBuilderPanel
        sku={workflow.sku}
        onSkuChange={workflow.setSku}
        quantity={workflow.quantity}
        onQuantityChange={workflow.setQuantity}
        inventorySuggestions={workflow.inventorySearch.data ?? []}
        suggestedItem={workflow.suggestedItem}
        onSelectSuggestion={workflow.setSku}
        onAddItem={workflow.addItem}
        onReviewTotal={workflow.reviewTotal}
        paymentMethod={workflow.paymentMethod}
        onPaymentMethodChange={workflow.setPaymentMethod}
        paymentNote={workflow.paymentNote}
        onPaymentNoteChange={workflow.setPaymentNote}
        onCheckout={workflow.checkout}
        cartId={workflow.cartId}
        summary={workflow.summary}
        isPending={workflow.isPending}
      />
      <PosReviewPanel
        summary={workflow.summary}
        stockIssueBySku={workflow.stockIssueBySku}
        lineQuantities={workflow.lineQuantities}
        onLineQuantityChange={(cartItemId, value) =>
          workflow.setLineQuantities((current) => ({
            ...current,
            [cartItemId]: value,
          }))
        }
        onLineQuantityBlur={async (cartItemId, currentQuantity) => {
          const nextQuantity = Number(workflow.lineQuantities[cartItemId] ?? currentQuantity);
          if (!Number.isFinite(nextQuantity) || nextQuantity < 1) {
            workflow.setLineQuantities((current) => ({
              ...current,
              [cartItemId]: String(currentQuantity),
            }));
            return;
          }

          await workflow.updateCartLine(cartItemId, Math.max(1, nextQuantity));
        }}
        onDecrease={(cartItemId, quantity) => {
          void workflow.updateCartLine(cartItemId, Math.max(1, quantity - 1));
        }}
        onIncrease={(cartItemId, quantity) => {
          void workflow.updateCartLine(cartItemId, quantity + 1);
        }}
        onRemove={(cartItemId) => {
          void workflow.removeCartLine(cartItemId);
        }}
        isPending={workflow.isPending}
      />
    </div>
  );
}
