import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityPage } from './CommunityPage';
import { apiRequest, graphQLRequest } from '../../lib/api';
import { createContextValue, createSession, renderWithProviders } from '../../test/utils';

vi.mock('../../lib/api', () => ({
  apiRequest: vi.fn(),
  graphQLRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  API_BASE_URL: 'http://localhost:4000',
  GRAPHQL_URL: 'http://localhost:4000/graphql',
}));

describe('CommunityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(graphQLRequest).mockImplementation(async (_query, variables) => {
      if (!variables) {
        return {
          catalog: {
            featured: [
              {
                id: 'title-1',
                slug: 'quiet-harbor-digital',
                name: 'Quiet Harbor',
                format: 'DIGITAL',
                price: 12.99,
                inventoryOnHand: 10,
                authorName: 'Lian Sun',
                authorId: 'author-1',
                seriesName: 'Harbor Cycle',
                seriesId: 'series-1',
              },
              {
                id: 'title-2',
                slug: 'archive-at-dawn',
                name: 'Archive At Dawn',
                format: 'DIGITAL',
                price: 10.99,
                inventoryOnHand: 5,
                authorName: 'Mira Vale',
                authorId: 'author-2',
                seriesName: 'Atlas Files',
                seriesId: 'series-2',
              },
            ],
            bestSellers: [],
          },
        };
      }

      const titleId = (variables as { titleId: string }).titleId;
      return {
        communityThread: {
          titleId,
          viewerHasFavorited: titleId === 'title-1',
          viewerFollowsAuthor: titleId === 'title-1',
          viewerFollowsSeries: titleId === 'title-2',
          averageRating: 4.6,
          totalRatings: 12,
          comments: [],
        },
      };
    });
  });

  it('hydrates favorite and follow controls from the backend for each title', async () => {
    renderWithProviders(<CommunityPage />, {
      route: '/app/community',
      queryClient: new QueryClient({
        defaultOptions: {
          queries: { retry: false },
        },
      }),
      contextValue: createContextValue({
        session: createSession({
          user: {
            id: 'reader-1',
            username: 'reader.ada',
            role: 'CUSTOMER',
            workspace: 'app',
          },
          homePath: '/app/community',
        }),
      }),
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Unfavorite' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Unfollow Author' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow Series' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByDisplayValue('Quiet Harbor'), 'title-2');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Favorite' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Follow Author' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unfollow Series' })).toBeInTheDocument();
  });

  it('surfaces backend community mutation failures through user-facing toasts', async () => {
    const addToast = vi.fn();
    vi.mocked(apiRequest).mockRejectedValue(new Error('Comment rate limit reached for the current minute.'));

    renderWithProviders(<CommunityPage />, {
      route: '/app/community',
      queryClient: new QueryClient({
        defaultOptions: {
          queries: { retry: false },
        },
      }),
      contextValue: createContextValue({
        session: createSession({
          user: {
            id: 'reader-1',
            username: 'reader.ada',
            role: 'CUSTOMER',
            workspace: 'app',
          },
          homePath: '/app/community',
        }),
        addToast,
      }),
    });

    await screen.findByRole('button', { name: 'Unfavorite' });
    const composer = screen.getByPlaceholderText(
      'Share a thought, ask a question, or answer a thread...',
    ) as HTMLTextAreaElement;

    fireEvent.change(composer, { target: { value: 'A local reader note' } });
    await userEvent.click(screen.getByRole('button', { name: 'Post Comment' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('Comment rate limit reached for the current minute.');
    });
  });
});
