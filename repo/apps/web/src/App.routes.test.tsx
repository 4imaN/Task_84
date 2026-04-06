import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('App routing and session handling', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('revalidates the cookie-backed session and redirects expired sessions to the workspace login', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'The session has expired.' }),
    } as Response);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/pos/checkout']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Clerk Checkout Workspace')).toBeInTheDocument();
    });
  });

  it('allows inventory managers to reach settlement and audit pages in the admin workspace', async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user: {
              id: 'inventory-1',
              username: 'inventory.ivan',
              role: 'INVENTORY_MANAGER',
              workspace: 'admin',
            },
            homePath: '/admin/overview',
            traceId: 'trace-1',
            csrfToken: 'csrf-admin-1',
          }),
        } as Response;
      }

      if (url.endsWith('/admin/settlements')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            paymentPlans: [],
            discrepancies: [
              {
                id: 'disc-1',
                sku: 'SKU-QH-PRINT',
                quantity_difference: 2,
                amount_difference_cents: 800,
                amountDifference: 8,
                status: 'OPEN',
                created_at: '2026-03-29T10:00:00.000Z',
                updated_at: '2026-03-29T10:00:00.000Z',
                allowedTransitions: ['UNDER_REVIEW', 'RESOLVED', 'WAIVED'],
              },
            ],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/admin/finance']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Manager Operations Console')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Finance' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audits' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inventory' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Import Manifest')).toBeInTheDocument();
      expect(screen.getByText('Discrepancy Review')).toBeInTheDocument();
      expect(screen.getByText('SKU-QH-PRINT')).toBeInTheDocument();
    });
  });

  it('routes finance sessions into the dedicated finance workspace', async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user: {
              id: 'finance-1',
              username: 'finance.zoe',
              role: 'FINANCE',
              workspace: 'finance',
            },
            homePath: '/finance/settlements',
            traceId: 'trace-2',
            csrfToken: 'csrf-finance-1',
          }),
        } as Response;
      }

      if (url.endsWith('/admin/settlements')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            paymentPlans: [],
            discrepancies: [
              {
                id: 'disc-1',
                sku: 'SKU-QH-PRINT',
                quantity_difference: 2,
                amount_difference_cents: 800,
                amountDifference: 8,
                status: 'OPEN',
                created_at: '2026-03-29T10:00:00.000Z',
                updated_at: '2026-03-29T10:00:00.000Z',
                allowedTransitions: ['UNDER_REVIEW', 'RESOLVED', 'WAIVED'],
              },
            ],
          }),
        } as Response;
      }

      if (url.endsWith('/admin/audit-logs')) {
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/finance/settlements']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Finance & Reconciliation')).toBeInTheDocument();
      expect(screen.getByText('Discrepancy Review')).toBeInTheDocument();
      expect(screen.getByText('SKU-QH-PRINT')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Settlements' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audits' })).toBeInTheDocument();
  });
});
