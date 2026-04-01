import { Routes, Route } from 'react-router-dom';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute';
import { createContextValue, createSession, renderWithProviders } from '../test/utils';

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to the workspace login page', () => {
    renderWithProviders(
      <Routes>
        <Route path="/pos/login" element={<div>POS Login</div>} />
        <Route element={<ProtectedRoute roles={['CLERK']} loginPath="/pos/login" />}>
          <Route path="/pos/checkout" element={<div>POS Checkout</div>} />
        </Route>
      </Routes>,
      {
        route: '/pos/checkout',
        contextValue: createContextValue({
          session: null,
          profile: null,
        }),
      },
    );

    expect(screen.getByText('POS Login')).toBeInTheDocument();
  });

  it('redirects authenticated users with the wrong role back to their own home path', () => {
    renderWithProviders(
      <Routes>
        <Route path="/app/library" element={<div>Library</div>} />
        <Route element={<ProtectedRoute roles={['CLERK']} loginPath="/pos/login" />}>
          <Route path="/pos/checkout" element={<div>POS Checkout</div>} />
        </Route>
      </Routes>,
      {
        route: '/pos/checkout',
        contextValue: createContextValue({
          session: createSession(),
        }),
      },
    );

    expect(screen.getByText('Library')).toBeInTheDocument();
  });
});
