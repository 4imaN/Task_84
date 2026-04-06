import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReadingProfileRecord } from '@ledgerread/contracts';
import { vi } from 'vitest';
import { AppContext, type AppContextValue } from '../context/AppContext';
import type { AppSession } from '../lib/types';

export const createSession = (
  overrides: Partial<AppSession> = {},
): AppSession => ({
  user: {
    id: 'user-1',
    username: 'reader.ada',
    role: 'CUSTOMER',
    workspace: 'app',
  },
  homePath: '/app/library',
  csrfToken: 'csrf-token-test',
  ...overrides,
});

export const createProfile = (
  overrides: Partial<ReadingProfileRecord> = {},
): ReadingProfileRecord => ({
  username: 'reader.ada',
  deviceLabel: 'Reader Browser',
  updatedAt: '2026-03-29T00:00:00.000Z',
  preferences: {
    fontFamily: 'Merriweather',
    fontSize: 18,
    lineSpacing: 1.5,
    readerMode: 'PAGINATION',
    theme: 'paper',
    nightMode: false,
    chineseMode: 'SIMPLIFIED',
    updatedAt: '2026-03-29T00:00:00.000Z',
  },
  ...overrides,
});

export const createContextValue = (
  overrides: Partial<AppContextValue> = {},
): AppContextValue => ({
  session: createSession(),
  setSession: vi.fn(),
  sessionReady: true,
  profile: createProfile(),
  setProfile: vi.fn(),
  profileReady: true,
  profileError: null,
  retryProfile: vi.fn(),
  nightMode: false,
  setNightMode: vi.fn(),
  addToast: vi.fn(),
  ...overrides,
});

export const renderWithProviders = (
  ui: ReactElement,
  {
    route = '/',
    contextValue = createContextValue(),
    queryClient,
    wrapper,
  }: {
    route?: string;
    contextValue?: AppContextValue;
    queryClient?: QueryClient;
    wrapper?: ({ children }: { children: ReactNode }) => ReactElement;
  } = {},
) => {
  const client =
    queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

  const base = (
    <QueryClientProvider client={client}>
      <AppContext.Provider value={contextValue}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </AppContext.Provider>
    </QueryClientProvider>
  );

  return render(wrapper ? wrapper({ children: base }) : base);
};
