import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RolePageGuard } from './RolePageGuard';
import { createContextValue, createSession, renderWithProviders } from '../test/utils';

describe('RolePageGuard', () => {
  it('allows inventory managers to reach the finance page under the shared admin policy', () => {
    renderWithProviders(
      <Routes>
        <Route path="/admin/overview" element={<div>Overview Page</div>} />
        <Route
          path="/admin/finance"
          element={
            <RolePageGuard roles={['MANAGER', 'INVENTORY_MANAGER']} fallbackPath="/admin/overview">
              <div>Finance Page</div>
            </RolePageGuard>
          }
        />
      </Routes>,
      {
        route: '/admin/finance',
        contextValue: createContextValue({
          session: createSession({
            user: {
              id: 'inventory-1',
              username: 'inventory.ivan',
              role: 'INVENTORY_MANAGER',
              workspace: 'admin',
            },
            homePath: '/admin/overview',
          }),
          profile: null,
        }),
      },
    );

    expect(screen.getByText('Finance Page')).toBeInTheDocument();
  });
});
