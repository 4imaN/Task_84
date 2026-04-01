import { Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { AdminShell, CustomerShell, FinanceShell, ModeratorShell, PosShell } from './components/layout/workspace-shells';
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage';
import { AuditPage } from './pages/admin/AuditPage';
import { FinancePage } from './pages/admin/FinancePage';
import { InventoryPage } from './pages/admin/InventoryPage';
import { LoginPage } from './pages/auth/LoginPage';
import { CommunityPage } from './pages/customer/CommunityPage';
import { LibraryPage } from './pages/customer/LibraryPage';
import { ProfilePortabilityPage } from './pages/customer/ProfilePortabilityPage';
import { ReaderPage } from './pages/customer/ReaderPage';
import { ModeratorQueuePage } from './pages/moderation/ModeratorQueuePage';
import { AttendancePage } from './pages/pos/AttendancePage';
import { PosPage } from './pages/pos/PosPage';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { RolePageGuard } from './routes/RolePageGuard';
import { RootRedirect } from './routes/RootRedirect';
import { getAdminFallbackPath } from './lib/routing';
import { useAppContext } from './context/AppContext';

function AppRoutes() {
  const { session } = useAppContext();
  const adminFallback = getAdminFallbackPath(session?.user.role);

  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route path="/login" element={<LoginPage workspace="app" headline="Customer Reading Workspace" />} />
      <Route
        path="/pos/login"
        element={<LoginPage workspace="pos" headline="Clerk Checkout Workspace" />}
      />
      <Route
        path="/mod/login"
        element={<LoginPage workspace="mod" headline="Moderation Review Workspace" />}
      />
      <Route
        path="/admin/login"
        element={<LoginPage workspace="admin" headline="Manager Operations Workspace" />}
      />
      <Route
        path="/finance/login"
        element={<LoginPage workspace="finance" headline="Finance Settlement Workspace" />}
      />

      <Route path="/app" element={<ProtectedRoute roles={['CUSTOMER']} loginPath="/login" />}>
        <Route element={<CustomerShell />}>
          <Route index element={<Navigate to="/app/library" replace />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="reader/:titleId" element={<ReaderPage />} />
          <Route path="community" element={<CommunityPage />} />
          <Route path="profile" element={<ProfilePortabilityPage />} />
        </Route>
      </Route>

      <Route path="/pos" element={<ProtectedRoute roles={['CLERK']} loginPath="/pos/login" />}>
        <Route element={<PosShell />}>
          <Route index element={<Navigate to="/pos/checkout" replace />} />
          <Route path="checkout" element={<PosPage />} />
          <Route path="attendance" element={<AttendancePage />} />
        </Route>
      </Route>

      <Route path="/mod" element={<ProtectedRoute roles={['MODERATOR']} loginPath="/mod/login" />}>
        <Route element={<ModeratorShell />}>
          <Route index element={<Navigate to="/mod/queue" replace />} />
          <Route path="queue" element={<ModeratorQueuePage />} />
        </Route>
      </Route>

      <Route
        path="/admin"
        element={
          <ProtectedRoute
            roles={['MANAGER', 'INVENTORY_MANAGER']}
            loginPath="/admin/login"
          />
        }
      >
        <Route element={<AdminShell />}>
          <Route index element={<Navigate to={adminFallback} replace />} />
          <Route
            path="overview"
            element={
              <RolePageGuard roles={['MANAGER', 'INVENTORY_MANAGER']} fallbackPath={adminFallback}>
                <AdminOverviewPage />
              </RolePageGuard>
            }
          />
          <Route
            path="finance"
            element={
              <RolePageGuard roles={['MANAGER', 'INVENTORY_MANAGER']} fallbackPath={adminFallback}>
                <FinancePage />
              </RolePageGuard>
            }
          />
          <Route
            path="inventory"
            element={
              <RolePageGuard roles={['MANAGER', 'INVENTORY_MANAGER']} fallbackPath={adminFallback}>
                <InventoryPage />
              </RolePageGuard>
            }
          />
          <Route
            path="audits"
            element={
              <RolePageGuard roles={['MANAGER', 'INVENTORY_MANAGER']} fallbackPath={adminFallback}>
                <AuditPage />
              </RolePageGuard>
            }
          />
        </Route>
      </Route>

      <Route path="/finance" element={<ProtectedRoute roles={['FINANCE']} loginPath="/finance/login" />}>
        <Route element={<FinanceShell />}>
          <Route index element={<Navigate to="/finance/settlements" replace />} />
          <Route path="settlements" element={<FinancePage />} />
          <Route path="audits" element={<AuditPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppRoutes />
    </AppProvider>
  );
}
