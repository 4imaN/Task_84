import { Navigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';

export function RootRedirect() {
  const { session, sessionReady } = useAppContext();
  if (!sessionReady) {
    return <div className="shell-panel p-6 font-ui text-sm">Validating session...</div>;
  }

  return <Navigate to={session?.homePath ?? '/login'} replace />;
}
