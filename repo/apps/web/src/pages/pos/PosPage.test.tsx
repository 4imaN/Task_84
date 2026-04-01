import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PosPage } from './PosPage';
import { apiRequest } from '../../lib/api';
import { createContextValue, createSession, renderWithProviders } from '../../test/utils';

vi.mock('../../lib/api', () => ({
  apiRequest: vi.fn(),
  graphQLRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  API_BASE_URL: 'http://localhost:4000',
  GRAPHQL_URL: 'http://localhost:4000/graphql',
}));

const summaryForQuantity = (quantity: number, reviewReady: boolean) => ({
  cartId: 'cart-1',
  items: [
    {
      cartItemId: 'line-1',
      sku: 'SKU-QH-PRINT',
      name: 'Quiet Harbor Hardcover',
      quantity,
      unitPrice: 24.99,
      onHand: 32,
    },
  ],
  suggestions: [],
  stockIssues: [],
  subtotal: 24.99 * quantity,
  discount: 0,
  fees: 0,
  total: 24.99 * quantity,
  reviewReady,
  reviewedAt: reviewReady ? '2026-03-29T12:00:00.000Z' : null,
});

const summaryWithStockIssue = () => ({
  cartId: 'cart-1',
  items: [
    {
      cartItemId: 'line-1',
      sku: 'SKU-QH-PRINT',
      name: 'Quiet Harbor Hardcover',
      quantity: 3,
      unitPrice: 24.99,
      onHand: 1,
    },
  ],
  suggestions: [],
  stockIssues: [
    {
      sku: 'SKU-QH-PRINT',
      requestedQuantity: 3,
      availableQuantity: 1,
    },
  ],
  subtotal: 74.97,
  discount: 0,
  fees: 0,
  total: 74.97,
  reviewReady: false,
  reviewedAt: null,
});

describe('PosPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (String(path).startsWith('/pos/search')) {
        return [
          {
            sku: 'SKU-QH-PRINT',
            name: 'Quiet Harbor Hardcover',
            titleName: 'Quiet Harbor',
            format: 'PHYSICAL',
            onHand: 32,
            price: 24.99,
          },
        ];
      }

      if (path === '/pos/carts' && options?.method === 'POST') {
        return { cartId: 'cart-1' };
      }

      if (path === '/pos/carts/cart-1/items' && options?.method === 'POST') {
        return summaryForQuantity(1, false);
      }

      if (path === '/pos/carts/cart-1/review-total') {
        return summaryForQuantity(1, true);
      }

      if (path === '/pos/carts/cart-1/items/line-1' && options?.method === 'PATCH') {
        const body = JSON.parse(String(options.body)) as { quantity: number };
        return summaryForQuantity(body.quantity, false);
      }

      return { orderId: 'order-1', total: 24.99 };
    });
  });

  it('keeps checkout locked until review and relocks it after a quantity change', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    renderWithProviders(<PosPage />, {
      route: '/pos/checkout',
      queryClient,
      contextValue: createContextValue({
        session: createSession({
          user: {
            id: 'clerk-1',
            username: 'clerk.emma',
            role: 'CLERK',
            workspace: 'pos',
          },
          homePath: '/pos/checkout',
        }),
        profile: null,
      }),
    });

    const finalize = screen.getByRole('button', { name: 'Finalize Checkout' });
    expect(finalize).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Add SKU' }));

    await waitFor(() => {
      expect(screen.getAllByText('Quiet Harbor Hardcover').length).toBeGreaterThan(0);
    });
    expect(finalize).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Review Total' }));

    await waitFor(() => {
      expect(finalize).toBeEnabled();
    });

    const quantityInput = screen.getByLabelText('Quantity for Quiet Harbor Hardcover');
    await userEvent.clear(quantityInput);
    await userEvent.type(quantityInput, '2');
    await userEvent.tab();

    await waitFor(() => {
      expect(finalize).toBeDisabled();
    });
    expect(apiRequest).toHaveBeenCalledWith(
      '/pos/carts/cart-1/items/line-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ quantity: 2 }),
      }),
      expect.anything(),
    );
  });

  it('renders blocking stock issues and keeps checkout disabled until inventory is resolved', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (String(path).startsWith('/pos/search')) {
        return [
          {
            sku: 'SKU-QH-PRINT',
            name: 'Quiet Harbor Hardcover',
            titleName: 'Quiet Harbor',
            format: 'PHYSICAL',
            onHand: 1,
            price: 24.99,
          },
        ];
      }

      if (path === '/pos/carts' && options?.method === 'POST') {
        return { cartId: 'cart-1' };
      }

      if (path === '/pos/carts/cart-1/items' && options?.method === 'POST') {
        return summaryWithStockIssue();
      }

      return summaryWithStockIssue();
    });

    renderWithProviders(<PosPage />, {
      route: '/pos/checkout',
      queryClient: new QueryClient({
        defaultOptions: {
          queries: { retry: false },
        },
      }),
      contextValue: createContextValue({
        session: createSession({
          user: {
            id: 'clerk-1',
            username: 'clerk.emma',
            role: 'CLERK',
            workspace: 'pos',
          },
          homePath: '/pos/checkout',
        }),
        profile: null,
      }),
    });

    const cartBuilderQuantity = screen
      .getAllByRole('spinbutton')
      .find((element) => element.className.includes('pos-cart-quantity-field'));
    expect(cartBuilderQuantity).toBeTruthy();
    await userEvent.clear(cartBuilderQuantity!);
    await userEvent.type(cartBuilderQuantity!, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Add SKU' }));

    await waitFor(() => {
      expect(screen.getByText('Blocking Inventory Issues')).toBeInTheDocument();
    });
    expect(screen.getByText(/requested 3, available 1/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalize Checkout' })).toBeDisabled();
  });

  it('surfaces stale review failures through a user-facing toast', async () => {
    const addToast = vi.fn();
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (String(path).startsWith('/pos/search')) {
        return [
          {
            sku: 'SKU-QH-PRINT',
            name: 'Quiet Harbor Hardcover',
            titleName: 'Quiet Harbor',
            format: 'PHYSICAL',
            onHand: 32,
            price: 24.99,
          },
        ];
      }

      if (path === '/pos/carts' && options?.method === 'POST') {
        return { cartId: 'cart-1' };
      }

      if (path === '/pos/carts/cart-1/items' && options?.method === 'POST') {
        return summaryForQuantity(1, false);
      }

      if (path === '/pos/carts/cart-1/review-total') {
        return summaryForQuantity(1, true);
      }

      if (path === '/pos/carts/cart-1/checkout') {
        throw {
          payload: {
            message: 'The cart changed after review. Run review total again before checkout.',
            reviewedTotal: 24.99,
            currentTotal: 25.99,
          },
        };
      }

      return { orderId: 'order-1', total: 24.99 };
    });

    renderWithProviders(<PosPage />, {
      route: '/pos/checkout',
      queryClient: new QueryClient({
        defaultOptions: {
          queries: { retry: false },
        },
      }),
      contextValue: createContextValue({
        session: createSession({
          user: {
            id: 'clerk-1',
            username: 'clerk.emma',
            role: 'CLERK',
            workspace: 'pos',
          },
          homePath: '/pos/checkout',
        }),
        profile: null,
        addToast,
      }),
    });

    await userEvent.click(screen.getByRole('button', { name: 'Add SKU' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review Total' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Finalize Checkout' })).toBeEnabled();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Finalize Checkout' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('The cart changed after review. Run review total again before checkout.');
    });
  });
});
