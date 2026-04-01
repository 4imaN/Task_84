import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext, type AppContextValue } from '../../context/AppContext';
import { createContextValue, createProfile, createSession } from '../../test/utils';
import { ReaderPage } from './ReaderPage';
import { apiRequest, graphQLRequest } from '../../lib/api';
import { cacheEncryptedTitle, loadCachedTitle, loadLocalProfile } from '../../lib/storage';

vi.mock('../../lib/api', () => ({
  apiRequest: vi.fn(),
  graphQLRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  API_BASE_URL: 'http://localhost:4000',
  GRAPHQL_URL: 'http://localhost:4000/graphql',
}));

vi.mock('../../lib/storage', async () => {
  const actual = await vi.importActual<typeof import('../../lib/storage')>('../../lib/storage');
  return {
    ...actual,
    cacheEncryptedTitle: vi.fn(),
    loadLocalProfile: vi.fn(),
    loadCachedTitle: vi.fn(),
  };
});

function StatefulContext({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState(
    createProfile({
      preferences: {
        ...createProfile().preferences,
        chineseMode: 'SIMPLIFIED',
      },
    }),
  );

  const setProfile = (nextProfile: Parameters<AppContextValue['setProfile']>[0]) => {
    if (!nextProfile) {
      return;
    }

    setProfileState(nextProfile);
  };

  const value: AppContextValue = createContextValue({
    session: createSession(),
    profile,
    setProfile,
  });

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

describe('ReaderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadLocalProfile).mockResolvedValue(null);
    vi.mocked(loadCachedTitle).mockResolvedValue(null);
    vi.mocked(cacheEncryptedTitle).mockResolvedValue(undefined);
    vi.mocked(apiRequest).mockResolvedValue({});
    vi.mocked(graphQLRequest).mockResolvedValue({
      title: {
        id: 'title-1',
        slug: 'quiet-harbor-digital',
        name: 'Quiet Harbor',
        format: 'DIGITAL',
        price: 12.99,
        inventoryOnHand: 999,
        authorName: 'Lian Sun',
        authorId: 'author-1',
        averageRating: 4.7,
        readingPreferences: createProfile().preferences,
        chapters: [
          {
            id: 'chapter-1',
            order: 1,
            name: 'Opening',
            body: '简体正文',
            bodySimplified: '简体正文',
            bodyTraditional: '繁體正文',
          },
        ],
      },
    });
  });

  it('switches the visible chapter body immediately when Chinese mode changes', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StatefulContext>
          <MemoryRouter initialEntries={['/app/reader/title-1']}>
            <Routes>
              <Route path="/app/reader/:titleId" element={<ReaderPage />} />
            </Routes>
          </MemoryRouter>
        </StatefulContext>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('简体正文')).toBeInTheDocument();
    });

    await userEvent.selectOptions(screen.getByDisplayValue('Simplified Chinese'), 'TRADITIONAL');

    await waitFor(() => {
      expect(screen.getByText('繁體正文')).toBeInTheDocument();
    });
  });

  it('renders a retryable error state when the title fetch fails and no encrypted cache exists', async () => {
    vi.mocked(graphQLRequest).mockRejectedValue(new Error('The title service is unavailable.'));
    vi.mocked(loadCachedTitle).mockResolvedValue(null);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StatefulContext>
          <MemoryRouter initialEntries={['/app/reader/title-1']}>
            <Routes>
              <Route path="/app/reader/:titleId" element={<ReaderPage />} />
            </Routes>
          </MemoryRouter>
        </StatefulContext>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Unable To Load Title')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('falls back to the encrypted offline cache when the title fetch fails', async () => {
    vi.mocked(graphQLRequest).mockRejectedValue(new Error('The title service is unavailable.'));
    vi.mocked(loadCachedTitle).mockResolvedValue({
      id: 'title-1',
      slug: 'quiet-harbor-digital',
      name: 'Quiet Harbor',
      format: 'DIGITAL',
      price: 12.99,
      inventoryOnHand: 999,
      authorName: 'Lian Sun',
      authorId: 'author-1',
      averageRating: 4.7,
      readingPreferences: createProfile().preferences,
      chapters: [
        {
          id: 'chapter-1',
          order: 1,
          name: 'Opening',
          body: '简体正文',
          bodySimplified: '简体正文',
          bodyTraditional: '繁體正文',
        },
      ],
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
        <StatefulContext>
          <MemoryRouter initialEntries={['/app/reader/title-1']}>
            <Routes>
              <Route path="/app/reader/:titleId" element={<ReaderPage />} />
            </Routes>
          </MemoryRouter>
        </StatefulContext>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Offline Reading Cache')).toBeInTheDocument();
    });
    expect(screen.getByText('Quiet Harbor')).toBeInTheDocument();
  });
});
