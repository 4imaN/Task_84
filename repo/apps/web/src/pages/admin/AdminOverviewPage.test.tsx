import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../lib/api';
import { createContextValue, renderWithProviders } from '../../test/utils';
import { AdminOverviewPage } from './AdminOverviewPage';

vi.mock('../../lib/api', () => ({
  apiRequest: vi.fn(),
  graphQLRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  API_BASE_URL: 'http://localhost:4000',
  GRAPHQL_URL: 'http://localhost:4000/graphql',
}));

describe('AdminOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows healthy audit integrity only when the backend verifier reports healthy chains', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === '/admin/settlements') {
        return { paymentPlans: [], discrepancies: [] };
      }

      if (path === '/admin/audit-integrity') {
        return {
          auditLogs: { valid: true, checkedEntries: 4, issues: [] },
          attendanceRecords: { valid: true, checkedEntries: 2, issues: [] },
        };
      }

      throw new Error(`Unexpected request: ${path}`);
    });

    renderWithProviders(<AdminOverviewPage />, {
      route: '/admin/overview',
      contextValue: createContextValue(),
    });

    await waitFor(() => {
      expect(screen.getByText('Audit Integrity')).toBeInTheDocument();
    });
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('shows invalid audit integrity when either chain verifier fails', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === '/admin/settlements') {
        return { paymentPlans: [], discrepancies: [] };
      }

      if (path === '/admin/audit-integrity') {
        return {
          auditLogs: { valid: false, checkedEntries: 4, issues: [{ rowId: 'audit-1', reason: 'tampered' }] },
          attendanceRecords: { valid: true, checkedEntries: 2, issues: [] },
        };
      }

      throw new Error(`Unexpected request: ${path}`);
    });

    renderWithProviders(<AdminOverviewPage />, {
      route: '/admin/overview',
      contextValue: createContextValue(),
    });

    await waitFor(() => {
      expect(screen.getByText('Invalid')).toBeInTheDocument();
    });
  });

  it('shows unknown audit integrity when the backend check cannot be loaded', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === '/admin/settlements') {
        return { paymentPlans: [], discrepancies: [] };
      }

      if (path === '/admin/audit-integrity') {
        throw new Error('Verifier unavailable.');
      }

      throw new Error(`Unexpected request: ${path}`);
    });

    renderWithProviders(<AdminOverviewPage />, {
      route: '/admin/overview',
      contextValue: createContextValue(),
    });

    await waitFor(() => {
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
  });
});
