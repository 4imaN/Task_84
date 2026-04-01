import { Navigate, Outlet } from 'react-router-dom';
import type { Role } from '@ledgerread/contracts';
import { useAppContext } from '../context/AppContext';

export function ProtectedRoute({ roles, loginPath }: { roles: Role[]; loginPath: string }) {
  const { session, sessionReady } = useAppContext();

  if (!sessionReady) {
    return <div className="shell-panel p-6 font-ui text-sm">Validating session...</div>;
  }

  if (!session) {
    return <Navigate to={loginPath} replace />;
  }

  if (!roles.includes(session.user.role)) {
    return <Navigate to={session.homePath} replace />;
  }

  return <Outlet />;
}
