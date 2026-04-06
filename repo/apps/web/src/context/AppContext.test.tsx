import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider, useAppContext } from './AppContext';
import type { AppSession } from '../lib/types';
import { apiRequest } from '../lib/api';
import { getLegacyThemeStorageKey, getThemeStorageKey } from '../lib/storageKeys';

vi.mock('../lib/api', () => ({
  apiRequest: vi.fn(),
  graphQLRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  API_BASE_URL: 'http://localhost:4000',
  GRAPHQL_URL: 'http://localhost:4000/graphql',
}));

const inventorySession: AppSession = {
  user: {
    id: 'inventory-1',
    username: 'inventory.ivan',
    role: 'INVENTORY_MANAGER',
    workspace: 'admin',
  },
  homePath: '/admin/overview',
  csrfToken: 'csrf-inventory-1',
};

const managerSession: AppSession = {
  user: {
    id: 'manager-1',
    username: 'manager.li',
    role: 'MANAGER',
    workspace: 'admin',
  },
  homePath: '/admin/overview',
  csrfToken: 'csrf-manager-1',
};

function Harness() {
  const { nightMode, setNightMode, setSession } = useAppContext();

  return (
    <div>
      <div data-testid="night-mode">{nightMode ? 'dark' : 'light'}</div>
      <button onClick={() => setSession(inventorySession)} type="button">
        Login Inventory
      </button>
      <button onClick={() => setSession(managerSession)} type="button">
        Login Manager
      </button>
      <button onClick={() => setSession(null)} type="button">
        Logout
      </button>
      <button onClick={() => setNightMode(true)} type="button">
        Enable Night
      </button>
    </div>
  );
}

describe('AppProvider state isolation', () => {
  const originalClassName = document.documentElement.className;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRequest).mockRejectedValue({
      status: 401,
      message: 'Authentication is required.',
    });
  });

  afterEach(() => {
    document.documentElement.className = originalClassName;
  });

  it('keeps persisted night mode username-scoped across logout and user replacement', async () => {
    window.localStorage.setItem(getLegacyThemeStorageKey('inventory.ivan'), 'true');

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/admin/overview']}>
          <AppProvider>
            <Harness />
          </AppProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Login Inventory' }));

    await waitFor(() => {
      expect(screen.getByTestId('night-mode')).toHaveTextContent('dark');
    });
    expect(window.localStorage.getItem(getLegacyThemeStorageKey('inventory.ivan'))).toBeNull();
    expect(window.localStorage.getItem(getThemeStorageKey('inventory.ivan'))).toBe('true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await userEvent.click(screen.getByRole('button', { name: 'Login Manager' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enable Night' }));

    await waitFor(() => {
      expect(screen.getByTestId('night-mode')).toHaveTextContent('dark');
    });
    expect(window.localStorage.getItem(getThemeStorageKey('manager.li'))).toBe('true');
    expect(
      Object.keys(window.localStorage).every(
        (key) => !key.includes('inventory.ivan') && !key.includes('manager.li'),
      ),
    ).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
