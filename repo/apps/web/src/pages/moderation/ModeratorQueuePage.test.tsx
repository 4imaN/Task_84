import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModeratorQueuePage } from './ModeratorQueuePage';
import { apiRequest } from '../../lib/api';
import { createContextValue, createSession, renderWithProviders } from '../../test/utils';

vi.mock('../../lib/api', () => ({
  apiRequest: vi.fn(),
  graphQLRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  API_BASE_URL: 'http://localhost:4000',
  GRAPHQL_URL: 'http://localhost:4000/graphql',
}));

describe('ModeratorQueuePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === '/moderation/queue?status=OPEN') {
        return [
          {
            id: 'report-open',
            category: 'ABUSE',
            notes: 'Open report',
            status: 'OPEN',
            created_at: '2026-03-29T12:00:00.000Z',
            comment_id: 'comment-open',
            comment_body: 'Open body',
            comment_hidden: false,
            comment_author_id: 'user-open',
            comment_author_name: 'Open Author',
            title_name: 'Quiet Harbor',
            reporter_name: 'Reader Ada',
          },
        ];
      }

      if (path === '/moderation/queue?status=RESOLVED') {
        return [
          {
            id: 'report-resolved',
            category: 'ABUSE',
            notes: 'Resolved report',
            status: 'RESOLVED',
            created_at: '2026-03-29T12:00:00.000Z',
            comment_id: 'comment-resolved',
            comment_body: 'Resolved body',
            comment_hidden: true,
            comment_author_id: 'user-resolved',
            comment_author_name: 'Resolved Author',
            title_name: 'Quiet Harbor',
            reporter_name: 'Reader Mei',
          },
        ];
      }

      if (path === '/moderation/actions' && options?.method === 'POST') {
        return { actionId: 'action-1' };
      }

      return [];
    });
  });

  it('exposes the restore workflow from the resolved moderation queue', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    renderWithProviders(<ModeratorQueuePage />, {
      route: '/mod/queue',
      queryClient,
      contextValue: createContextValue({
        session: createSession({
          user: {
            id: 'mod-1',
            username: 'mod.noah',
            role: 'MODERATOR',
            workspace: 'mod',
          },
          homePath: '/mod/queue',
        }),
        profile: null,
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('Open body')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Resolved' }));

    await waitFor(() => {
      expect(screen.getByText('Resolved body')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));

    expect(apiRequest).toHaveBeenCalledWith(
      '/moderation/actions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"action":"restore"'),
      }),
      expect.anything(),
    );
  });
});
