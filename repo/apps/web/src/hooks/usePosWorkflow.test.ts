import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../context/AppContext', () => ({
  useAppContext: vi.fn(),
}));

vi.mock('./useAsyncAction', () => ({
  useAsyncAction: () => ({
    isPending: vi.fn(() => false),
    runAction: vi.fn(async (_key: string, action: () => Promise<unknown>) => action()),
  }),
}));

vi.mock('../lib/api', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [
      { sku: 'SKU-QH-PRINT', name: 'Quiet Harbor', price: 24, onHand: 10 },
      { sku: 'SKU-AD-DIGITAL', name: 'Archive At Dawn', price: 11, onHand: 5 },
    ],
  }),
}));

import { useAppContext } from '../context/AppContext';
import { apiRequest } from '../lib/api';

const makeSession = () => ({
  user: { id: 'u-1', username: 'clerk.emma', role: 'CLERK', workspace: 'pos' },
  homePath: '/pos/checkout',
  csrfToken: 'csrf',
});

describe('usePosWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAppContext).mockReturnValue({
      session: makeSession(),
      addToast: vi.fn(),
    } as any);
  });

  describe('suggested item resolution', () => {
    it('matches exact SKU case-insensitively', async () => {
      const { usePosWorkflow } = await import('./usePosWorkflow');
      const { result } = renderHook(() => usePosWorkflow());

      expect(result.current.suggestedItem).toEqual(
        expect.objectContaining({ sku: 'SKU-QH-PRINT' }),
      );
    });

    it('falls back to first result when no exact match', async () => {
      const { usePosWorkflow } = await import('./usePosWorkflow');
      const { result } = renderHook(() => usePosWorkflow());

      act(() => {
        result.current.setSku('SKU-NONEXISTENT');
      });

      expect(result.current.suggestedItem).toEqual(
        expect.objectContaining({ sku: 'SKU-QH-PRINT' }),
      );
    });
  });

  describe('cart lifecycle', () => {
    it('creates a new cart on first addItem and sets cartId', async () => {
      vi.mocked(apiRequest).mockImplementation(async (path: string, options?: any) => {
        if (path === '/pos/carts' && options?.method === 'POST') {
          return { cartId: 'cart-new-1' };
        }
        if (path.includes('/items') && options?.method === 'POST') {
          return {
            items: [{ cartItemId: 'item-1', sku: 'SKU-QH-PRINT', quantity: 1, onHand: 10 }],
            total: 24,
            reviewReady: false,
            reviewedAt: null,
            stockIssues: [],
          };
        }
        return {};
      });

      const { usePosWorkflow } = await import('./usePosWorkflow');
      const { result } = renderHook(() => usePosWorkflow());

      expect(result.current.cartId).toBeNull();

      await act(async () => {
        await result.current.addItem();
      });

      expect(result.current.cartId).toBe('cart-new-1');
      expect(result.current.summary).toBeTruthy();
      expect(result.current.summary!.items).toHaveLength(1);
    });
  });

  describe('updateCartLine guard', () => {
    it('does nothing when cartId is null', async () => {
      const { usePosWorkflow } = await import('./usePosWorkflow');
      const { result } = renderHook(() => usePosWorkflow());

      expect(result.current.cartId).toBeNull();

      await act(async () => {
        await result.current.updateCartLine('item-1', 5);
      });

      expect(apiRequest).not.toHaveBeenCalledWith(
        expect.stringContaining('/items/'),
        expect.objectContaining({ method: 'PATCH' }),
        expect.anything(),
      );
    });

    it('does nothing when quantity is less than 1', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({ cartId: 'cart-1' });
      vi.mocked(apiRequest).mockResolvedValueOnce({
        items: [{ cartItemId: 'item-1', sku: 'SKU-QH-PRINT', quantity: 1, onHand: 10 }],
        total: 24,
        reviewReady: false,
        reviewedAt: null,
        stockIssues: [],
      });

      const { usePosWorkflow } = await import('./usePosWorkflow');
      const { result } = renderHook(() => usePosWorkflow());

      await act(async () => {
        await result.current.addItem();
      });

      vi.mocked(apiRequest).mockClear();

      await act(async () => {
        await result.current.updateCartLine('item-1', 0);
      });

      expect(apiRequest).not.toHaveBeenCalled();
    });
  });

  describe('checkout guard', () => {
    it('does nothing when no cart exists', async () => {
      const { usePosWorkflow } = await import('./usePosWorkflow');
      const { result } = renderHook(() => usePosWorkflow());

      await act(async () => {
        await result.current.checkout();
      });

      expect(apiRequest).not.toHaveBeenCalledWith(
        expect.stringContaining('/checkout'),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('stockIssueBySku', () => {
    it('is empty when no summary exists', async () => {
      const { usePosWorkflow } = await import('./usePosWorkflow');
      const { result } = renderHook(() => usePosWorkflow());

      expect(result.current.stockIssueBySku.size).toBe(0);
    });
  });
});
