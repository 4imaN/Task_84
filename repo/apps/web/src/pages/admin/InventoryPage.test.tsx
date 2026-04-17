import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryPage } from './InventoryPage';
import { apiRequest } from '../../lib/api';
import { createContextValue, createSession, renderWithProviders } from '../../test/utils';

vi.mock('../../lib/api', () => ({
  apiRequest: vi.fn(),
  graphQLRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  API_BASE_URL: 'http://localhost:4000',
  GRAPHQL_URL: 'http://localhost:4000/graphql',
}));

describe('InventoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when there are no discrepancies', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      paymentPlans: [],
      discrepancies: [],
    });

    renderWithProviders(<InventoryPage />, {
      route: '/admin/inventory',
      contextValue: createContextValue({
        session: createSession({
          user: {
            id: 'inventory-1',
            username: 'inventory.ivan',
            role: 'INVENTORY_MANAGER',
            workspace: 'admin',
          },
          homePath: '/admin/overview',
        }),
        profile: null,
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('No Discrepancies')).toBeInTheDocument();
    });
    expect(screen.getByText('Inventory reconciliation is currently clear.')).toBeInTheDocument();
  });

  it('renders discrepancy content when data is available', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      paymentPlans: [],
      discrepancies: [
        {
          id: 'disc-1',
          sku: 'SKU-QH-PRINT',
          quantity_difference: 2,
          amount_difference_cents: 800,
          amountDifference: 8,
          status: 'OPEN',
          created_at: '2026-03-29T10:05:00.000Z',
          updated_at: '2026-03-29T10:05:00.000Z',
          statement_reference: 'STMT-1',
          invoice_reference: 'INV-1',
          allowedTransitions: ['UNDER_REVIEW', 'RESOLVED', 'WAIVED'],
        },
      ],
    });

    renderWithProviders(<InventoryPage />, {
      route: '/admin/inventory',
      contextValue: createContextValue({
        session: createSession({
          user: {
            id: 'inventory-1',
            username: 'inventory.ivan',
            role: 'INVENTORY_MANAGER',
            workspace: 'admin',
          },
          homePath: '/admin/overview',
        }),
        profile: null,
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('SKU-QH-PRINT')).toBeInTheDocument();
    });
  });

  it('shows error message when settlements query fails', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('Network failure'));

    renderWithProviders(<InventoryPage />, {
      route: '/admin/inventory',
      contextValue: createContextValue({
        session: createSession({
          user: {
            id: 'inventory-1',
            username: 'inventory.ivan',
            role: 'INVENTORY_MANAGER',
            workspace: 'admin',
          },
          homePath: '/admin/overview',
        }),
        profile: null,
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('Inventory discrepancy data could not be loaded.')).toBeInTheDocument();
    });
  });
});
