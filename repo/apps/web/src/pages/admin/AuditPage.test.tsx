import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditPage } from './AuditPage';
import { apiRequest } from '../../lib/api';
import { createContextValue, createSession, renderWithProviders } from '../../test/utils';

vi.mock('../../lib/api', () => ({
  apiRequest: vi.fn(),
  graphQLRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  API_BASE_URL: 'http://localhost:4000',
  GRAPHQL_URL: 'http://localhost:4000/graphql',
}));

describe('AuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a retryable error state when audit data cannot be loaded', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('Audit log data could not be loaded.'));

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    renderWithProviders(<AuditPage />, {
      route: '/finance/audits',
      queryClient,
      contextValue: createContextValue({
        session: createSession({
          user: {
            id: 'finance-1',
            username: 'finance.zoe',
            role: 'FINANCE',
            workspace: 'finance',
          },
          homePath: '/finance/audits',
        }),
        profile: null,
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('Unable To Load')).toBeInTheDocument();
    });
    expect(screen.getByText('Audit log data could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
