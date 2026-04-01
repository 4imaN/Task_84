import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { Role } from '@ledgerread/contracts';
import { useAppContext } from '../context/AppContext';

export function RolePageGuard({
  roles,
  fallbackPath,
  children,
}: {
  roles: Role[];
  fallbackPath: string;
  children: ReactNode;
}) {
  const { session } = useAppContext();

  if (!session) {
    return <Navigate to={fallbackPath} replace />;
  }

  if (!roles.includes(session.user.role)) {
    return <Navigate to={fallbackPath} replace />;
  }

  return <>{children}</>;
}
