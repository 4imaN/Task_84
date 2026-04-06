import { Routes, Route } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { AppContext } from '../../context/AppContext';
import { createContextValue } from '../../test/utils';
import { apiRequest } from '../../lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';

vi.mock('../../lib/api', () => ({
  apiRequest: vi.fn(),
  graphQLRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  API_BASE_URL: 'http://localhost:4000',
  GRAPHQL_URL: 'http://localhost:4000/graphql',
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits credentials for the selected workspace and navigates to the returned home path', async () => {
    const setSession = vi.fn();
    vi.mocked(apiRequest).mockResolvedValue({
      user: {
        id: 'reader-1',
        username: 'reader.ada',
        role: 'CUSTOMER',
        workspace: 'app',
      },
      homePath: '/app/library',
      csrfToken: 'csrf-login-1',
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AppContext.Provider
          value={createContextValue({
            session: null,
            profile: null,
            setSession,
          })}
        >
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route
                path="/login"
                element={<LoginPage workspace="app" headline="Customer Reading Workspace" />}
              />
              <Route path="/app/library" element={<div>Library Home</div>} />
            </Routes>
          </MemoryRouter>
        </AppContext.Provider>
      </QueryClientProvider>,
    );

    await userEvent.type(screen.getByPlaceholderText('Username'), 'reader.ada');
    await userEvent.type(screen.getByPlaceholderText('Password'), 'Reader!2026');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(screen.getByText('Library Home')).toBeInTheDocument();
    });
    expect(apiRequest).toHaveBeenCalledWith(
      '/auth/login',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(setSession).toHaveBeenCalled();
  });

  it('surfaces login failure and lockout messaging without mutating session state', async () => {
    const setSession = vi.fn();
    const addToast = vi.fn();
    vi.mocked(apiRequest).mockRejectedValue(new Error('The account is temporarily locked.'));

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AppContext.Provider
          value={createContextValue({
            session: null,
            profile: null,
            setSession,
            addToast,
          })}
        >
          <MemoryRouter initialEntries={['/admin/login']}>
            <Routes>
              <Route
                path="/admin/login"
                element={<LoginPage workspace="admin" headline="Manager Operations Workspace" />}
              />
            </Routes>
          </MemoryRouter>
        </AppContext.Provider>
      </QueryClientProvider>,
    );

    await userEvent.type(screen.getByPlaceholderText('Username'), 'inventory.ivan');
    await userEvent.type(screen.getByPlaceholderText('Password'), 'Inventory!2026');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('The account is temporarily locked.');
    });
    expect(setSession).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});
