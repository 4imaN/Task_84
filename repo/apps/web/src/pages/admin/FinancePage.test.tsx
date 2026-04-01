import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
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
          statement_reference: 'STMT-1',
          invoice_reference: 'INV-1',
          invoiceAmount: 690,
          landedCost: 700,
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
          statement_reference: 'STMT-1',
          invoice_reference: 'INV-1',
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
    expect(screen.getAllByRole('link', { name: 'Open Audit Trail' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Open Audit Trail' })[0]).toHaveAttribute('href', '/finance/audits');
  });
});
