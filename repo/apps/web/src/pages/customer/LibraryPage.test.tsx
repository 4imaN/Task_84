import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphQLRequest } from '../../lib/api';
import { createContextValue, renderWithProviders } from '../../test/utils';
import { LibraryPage } from './LibraryPage';

vi.mock('../../lib/api', () => ({
  apiRequest: vi.fn(),
  graphQLRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  API_BASE_URL: 'http://localhost:4000',
  GRAPHQL_URL: 'http://localhost:4000/graphql',
}));

describe('LibraryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(graphQLRequest).mockResolvedValue({
      catalog: {
        featured: [
          {
            id: 'title-digital',
            slug: 'quiet-harbor-digital',
            name: 'Quiet Harbor',
            format: 'DIGITAL',
            isReadable: true,
            price: 12.99,
            inventoryOnHand: 999,
            authorName: 'Lian Sun',
            authorId: 'author-1',
          },
          {
            id: 'title-print',
            slug: 'quiet-harbor-print',
            name: 'Quiet Harbor Hardcover',
            format: 'PHYSICAL',
            isReadable: false,
            price: 24.99,
            inventoryOnHand: 32,
            authorName: 'Lian Sun',
            authorId: 'author-1',
          },
          {
            id: 'title-bundle',
            slug: 'staff-handbook',
            name: 'Staff Starter Bundle',
            format: 'BUNDLE',
            isReadable: false,
            price: 29.99,
            inventoryOnHand: 16,
            authorName: 'LedgerRead Ops',
            authorId: 'author-ops',
          },
        ],
        bestSellers: [],
      },
    });
  });

  it('navigates readable digital titles into the reader route', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    renderWithProviders(
      <Routes>
        <Route path="/app/library" element={<LibraryPage />} />
        <Route path="/app/reader/:titleId" element={<div>Reader Route</div>} />
      </Routes>,
      {
        route: '/app/library',
        queryClient,
        contextValue: createContextValue(),
      },
    );

    await waitFor(() => {
      expect(screen.getByText('Quiet Harbor')).toBeInTheDocument();
      expect(screen.getByText('Quiet Harbor Hardcover')).toBeInTheDocument();
      expect(screen.getByText('Staff Starter Bundle')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /DIGITAL Quiet Harbor/i }));
    await waitFor(() => {
      expect(screen.getByText('Reader Route')).toBeInTheDocument();
    });
  });

  it('does not navigate unreadable products into the reader route', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/app/library" element={<LibraryPage />} />
        <Route path="/app/reader/:titleId" element={<div>Reader Route</div>} />
      </Routes>,
      {
        route: '/app/library',
        queryClient: new QueryClient({
          defaultOptions: {
            queries: {
              retry: false,
            },
          },
        }),
        contextValue: createContextValue(),
      },
    );

    await waitFor(() => {
      expect(screen.getByText('Quiet Harbor Hardcover')).toBeInTheDocument();
      expect(screen.getByText('Staff Starter Bundle')).toBeInTheDocument();
    });

    const unreadablePhysicalButton = screen.getByRole('button', { name: /quiet harbor hardcover/i });
    const unreadableBundleButton = screen.getByRole('button', { name: /staff starter bundle/i });
    expect(unreadablePhysicalButton).toBeDisabled();
    expect(unreadableBundleButton).toBeDisabled();
    fireEvent.click(unreadablePhysicalButton);
    fireEvent.click(unreadableBundleButton);
    expect(screen.queryByText('Reader Route')).not.toBeInTheDocument();
    expect(screen.getAllByText('Reader unavailable').length).toBeGreaterThanOrEqual(2);
  });
});
