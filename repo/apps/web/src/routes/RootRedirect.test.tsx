import { Routes, Route } from 'react-router-dom';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RootRedirect } from './RootRedirect';
import { createContextValue, createSession, renderWithProviders } from '../test/utils';

describe('RootRedirect', () => {
  it('shows loading text while session is not ready', () => {
    renderWithProviders(
      <Routes>
        <Route path="/" element={<RootRedirect />} />
      </Routes>,
      {
        route: '/',
        contextValue: createContextValue({
          sessionReady: false,
          session: null,
        }),
      },
    );

    expect(screen.getByText('Validating session...')).toBeInTheDocument();
  });

  it('redirects to the session homePath when authenticated', () => {
    renderWithProviders(
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/app/library" element={<div>Library</div>} />
      </Routes>,
      {
        route: '/',
        contextValue: createContextValue({
          sessionReady: true,
          session: createSession({ homePath: '/app/library' }),
        }),
      },
    );

    expect(screen.getByText('Library')).toBeInTheDocument();
  });

  it('redirects to /login when no session exists', () => {
    renderWithProviders(
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>,
      {
        route: '/',
        contextValue: createContextValue({
          sessionReady: true,
          session: null,
        }),
      },
    );

    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });
});
