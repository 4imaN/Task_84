import { Outlet } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { getAllowedAdminNavigation } from '../../lib/routing';
import { WorkspaceScaffold } from './WorkspaceScaffold';

export function CustomerShell() {
  return (
    <WorkspaceScaffold
      title="Reader & Community"
      navigation={[
        { to: '/app/library', label: 'Library' },
        { to: '/app/community', label: 'Community' },
        { to: '/app/profile', label: 'Profile Sync' },
      ]}
    >
      <Outlet />
    </WorkspaceScaffold>
  );
}

export function PosShell() {
  return (
    <WorkspaceScaffold
      title="Clerk Checkout Console"
      navigation={[
        { to: '/pos/checkout', label: 'Checkout' },
        { to: '/pos/attendance', label: 'Attendance' },
      ]}
    >
      <Outlet />
    </WorkspaceScaffold>
  );
}

export function ModeratorShell() {
  return (
    <WorkspaceScaffold title="Moderation Queue" navigation={[{ to: '/mod/queue', label: 'Queue' }]}>
      <Outlet />
    </WorkspaceScaffold>
  );
}

export function AdminShell() {
  const { session } = useAppContext();
  const allowed = new Set(getAllowedAdminNavigation(session?.user.role));
  const navigation = [
    { to: '/admin/overview', label: 'Overview' },
    { to: '/admin/finance', label: 'Finance' },
    { to: '/admin/inventory', label: 'Inventory' },
    { to: '/admin/audits', label: 'Audits' },
  ].filter((item) => allowed.has(item.to));

  return (
    <WorkspaceScaffold
      title="Manager Operations Console"
      navigation={navigation}
    >
      <Outlet />
    </WorkspaceScaffold>
  );
}

export function FinanceShell() {
  return (
    <WorkspaceScaffold
      title="Finance & Reconciliation"
      navigation={[
        { to: '/finance/settlements', label: 'Settlements' },
        { to: '/finance/audits', label: 'Audits' },
      ]}
    >
      <Outlet />
    </WorkspaceScaffold>
  );
}
