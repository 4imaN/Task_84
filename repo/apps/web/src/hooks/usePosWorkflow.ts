import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppContext } from '../context/AppContext';
import { useAsyncAction } from './useAsyncAction';
import { apiRequest } from '../lib/api';
import { currency } from '../lib/format';
import type { CartSummary, InventorySuggestion, PaymentMethod } from '../lib/types';

type PosRequestError = Error & {
  status?: number;
  payload?: {
    message?: string;
    stockIssues?: CartSummary['stockIssues'];
    currentTotal?: number;
    reviewedTotal?: number;
  };
};

export function usePosWorkflow() {
  const { session } = useAppContext();
  const { isPending, runAction } = useAsyncAction();
  const [cartId, setCartId] = useState<string | null>(null);
  const [sku, setSku] = useState('SKU-QH-PRINT');
  const [quantity, setQuantity] = useState(1);
  const [summary, setSummary] = useState<CartSummary | null>(null);
  const [lineQuantities, setLineQuantities] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [paymentNote, setPaymentNote] = useState('Drawer 2');

  const inventorySearch = useQuery({
    queryKey: ['pos-search', sku],
    enabled: sku.trim().length >= 1,
    queryFn: () =>
      apiRequest<InventorySuggestion[]>(`/pos/search?q=${encodeURIComponent(sku.trim())}`, {}, session),
  });

  useEffect(() => {
    if (!summary) {
      setLineQuantities({});
      return;
    }

    setLineQuantities(
      Object.fromEntries(summary.items.map((item) => [item.cartItemId, String(item.quantity)])),
    );
  }, [summary]);

  const suggestedItem =
    inventorySearch.data?.find((item) => item.sku.toLowerCase() === sku.trim().toLowerCase()) ??
    inventorySearch.data?.[0] ??
    null;
  const stockIssueBySku = new Map((summary?.stockIssues ?? []).map((issue) => [issue.sku, issue]));

  const ensureCart = async () => {
    if (cartId) {
      return cartId;
    }
    const next = await apiRequest<{ cartId: string }>('/pos/carts', { method: 'POST' }, session);
    setCartId(next.cartId);
    return next.cartId;
  };

  const applyBlockingStockIssues = (issues: CartSummary['stockIssues']) => {
    setSummary((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        reviewReady: false,
        reviewedAt: null,
        stockIssues: issues,
        items: current.items.map((item) => {
          const issue = issues.find((entry) => entry.sku === item.sku);
          return issue
            ? {
                ...item,
                onHand: issue.availableQuantity,
              }
            : item;
        }),
      };
    });
  };

  const getPosFailureMessage = (error: unknown, fallback: string) => {
    const typed = error as PosRequestError;
    if (Array.isArray(typed.payload?.stockIssues)) {
      applyBlockingStockIssues(typed.payload.stockIssues);
    }

    if (typed.payload?.message) {
      return typed.payload.message;
    }

    if (typed.payload?.reviewedTotal !== undefined && typed.payload?.currentTotal !== undefined) {
      return `Review total is stale. Reviewed ${currency(typed.payload.reviewedTotal)}, current ${currency(typed.payload.currentTotal)}.`;
    }

    return error instanceof Error ? error.message : fallback;
  };

  const addItem = async () => {
    await runAction(
      'pos-add-item',
      async () => {
        const activeCartId = await ensureCart();
        const next = await apiRequest<CartSummary>(
          `/pos/carts/${activeCartId}/items`,
          {
            method: 'POST',
            body: JSON.stringify({ sku, quantity }),
          },
          session,
        );
        setSummary(next);
        return true;
      },
      {
        successMessage: 'Cart updated with live inventory feedback. Review total is required again before checkout.',
        errorMessage: (error) => (error instanceof Error ? error.message : 'Adding the SKU failed.'),
      },
    );
  };

  const updateCartLine = async (cartItemId: string, nextQuantity: number) => {
    if (!cartId || nextQuantity < 1) {
      return;
    }

    await runAction(
      `pos-update-line-${cartItemId}`,
      async () => {
        const next = await apiRequest<CartSummary>(
          `/pos/carts/${cartId}/items/${cartItemId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ quantity: nextQuantity }),
          },
          session,
        );
        setSummary(next);
        return true;
      },
      {
        successMessage: 'Line quantity updated. Review total is required again before checkout.',
        errorMessage: (error) => (error instanceof Error ? error.message : 'Line quantity update failed.'),
      },
    );
  };

  const removeCartLine = async (cartItemId: string) => {
    if (!cartId) {
      return;
    }

    await runAction(
      `pos-remove-line-${cartItemId}`,
      async () => {
        const next = await apiRequest<CartSummary>(
          `/pos/carts/${cartId}/items/${cartItemId}`,
          {
            method: 'DELETE',
          },
          session,
        );
        setSummary(next);
        return true;
      },
      {
        successMessage: 'Line removed. Review total is required again before checkout.',
        errorMessage: (error) => (error instanceof Error ? error.message : 'Removing the line failed.'),
      },
    );
  };

  const reviewTotal = async () => {
    await runAction(
      'pos-review-total',
      async () => {
        const activeCartId = await ensureCart();
        const next = await apiRequest<CartSummary>(
          `/pos/carts/${activeCartId}/review-total`,
          { method: 'POST' },
          session,
        );
        setSummary(next);
        return true;
      },
      {
        successMessage: 'Server-side review total completed.',
        errorMessage: (error) => getPosFailureMessage(error, 'Review total failed.'),
      },
    );
  };

  const checkout = async () => {
    if (!cartId) {
      return;
    }

    await runAction(
      'pos-checkout',
      async () => {
        const result = await apiRequest<{ orderId: string; total: number }>(
          `/pos/carts/${cartId}/checkout`,
          {
            method: 'POST',
            body: JSON.stringify({ paymentMethod, paymentNote }),
          },
          session,
        );
        setCartId(null);
        setSummary(null);
        return result;
      },
      {
        successMessage: (result) => `Checkout completed. Order ${result.orderId} recorded locally.`,
        errorMessage: (error) => getPosFailureMessage(error, 'Checkout failed.'),
      },
    );
  };

  return {
    cartId,
    sku,
    setSku,
    quantity,
    setQuantity,
    summary,
    lineQuantities,
    setLineQuantities,
    paymentMethod,
    setPaymentMethod,
    paymentNote,
    setPaymentNote,
    inventorySearch,
    suggestedItem,
    stockIssueBySku,
    isPending,
    addItem,
    updateCartLine,
    removeCartLine,
    reviewTotal,
    checkout,
  };
}
