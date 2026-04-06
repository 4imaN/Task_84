import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FinancePage } from './FinancePage';
import { apiRequest } from '../../lib/api';
import { createContextValue, createSession, renderWithProviders } from '../../test/utils';

vi.mock('../../lib/api', () => ({
  apiRequest: vi.fn(),
  graphQLRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  API_BASE_URL: 'http://localhost:4000',
  GRAPHQL_URL: 'http://localhost:4000/graphql',
}));

describe('FinancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading skeleton before rendering an empty settlements state', async () => {
    let resolveSettlements!: (value: any) => void;
    const settlementsPromise = new Promise<any>((resolve) => {
      resolveSettlements = resolve;
    });
    vi.mocked(apiRequest).mockReturnValue(settlementsPromise);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    const { container } = renderWithProviders(<FinancePage />, {
      route: '/finance/settlements',
      queryClient,
      contextValue: createContextValue({
        session: createSession({
          user: {
            id: 'finance-1',
            username: 'finance.zoe',
            role: 'FINANCE',
            workspace: 'finance',
          },
          homePath: '/finance/settlements',
        }),
        profile: null,
      }),
    });

    expect(container.querySelector('.skeleton')).toBeInTheDocument();

    resolveSettlements({
      paymentPlans: [],
      discrepancies: [],
    });

    await waitFor(() => {
      expect(screen.getByText('No Reconciliation Activity')).toBeInTheDocument();
    });
  });

  it('renders discrepancy review content and audit access for finance reconciliation users', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      paymentPlans: [
        {
          id: 'plan-1',
          supplier_name: 'North Pier Press',
          status: 'DISPUTED',
          created_at: '2026-03-29T10:00:00.000Z',
          updated_at: '2026-03-29T10:00:00.000Z',
          statement_reference: 'STMT-1',
          invoice_reference: 'INV-1',
          invoiceAmount: 690,
          landedCost: 700,
          allowedTransitions: ['PENDING', 'MATCHED', 'PARTIAL'],
        },
      ],
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

    renderWithProviders(<FinancePage />, {
      route: '/finance/settlements',
      contextValue: createContextValue({
        session: createSession({
          user: {
            id: 'finance-1',
            username: 'finance.zoe',
            role: 'FINANCE',
            workspace: 'finance',
          },
          homePath: '/finance/settlements',
        }),
        profile: null,
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('Discrepancy Review')).toBeInTheDocument();
    });
    expect(screen.getByText('Settlement Intake')).toBeInTheDocument();
    expect(screen.queryByText('Import Manifest')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import & Compare' })).not.toBeInTheDocument();
    expect(screen.getByText('SKU-QH-PRINT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark PENDING' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark UNDER_REVIEW' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open Audit Trail' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Open Audit Trail' })[0]).toHaveAttribute('href', '/finance/audits');
  });

  it('lets inventory managers advance discrepancy status without exposing payment-plan controls', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === '/admin/settlements') {
        return {
          paymentPlans: [
            {
              id: 'plan-1',
              supplier_name: 'North Pier Press',
              status: 'DISPUTED',
              created_at: '2026-03-29T10:00:00.000Z',
              updated_at: '2026-03-29T10:00:00.000Z',
              statement_reference: 'STMT-1',
              invoice_reference: 'INV-1',
              invoiceAmount: 690,
              landedCost: 700,
              allowedTransitions: ['PENDING', 'MATCHED', 'PARTIAL'],
            },
          ],
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
        };
      }

      if (path === '/admin/discrepancies/disc-1/status') {
        expect(options?.method).toBe('PATCH');
        expect(options?.body).toBe(JSON.stringify({ status: 'UNDER_REVIEW' }));
        return { id: 'disc-1', status: 'UNDER_REVIEW', updatedAt: '2026-03-29T10:10:00.000Z' };
      }

      throw new Error(`Unexpected request: ${path}`);
    });

    renderWithProviders(<FinancePage />, {
      route: '/admin/finance',
      contextValue: createContextValue({
        session: createSession({
          user: {
            id: 'inventory-1',
            username: 'inventory.ivan',
            role: 'INVENTORY_MANAGER',
            workspace: 'admin',
          },
          homePath: '/admin/finance',
        }),
        profile: null,
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('SKU-QH-PRINT')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Mark PENDING' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark UNDER_REVIEW' }));

    await waitFor(() => {
      expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
        '/admin/discrepancies/disc-1/status',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'UNDER_REVIEW' }),
        }),
        expect.anything(),
      );
    });
  });
});
