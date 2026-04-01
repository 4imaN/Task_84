import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAppContext } from '../../context/AppContext';
import { apiRequest } from '../../lib/api';
import { getWorkspaceLoginPath } from '../../lib/routing';
import { ThemeToggleButton } from '../common/ThemeToggleButton';

export function WorkspaceScaffold({
  title,
  children,
  navigation,
}: {
  title: string;
  children: ReactNode;
  navigation: Array<{ to: string; label: string }>;
}) {
  const { session, setSession } = useAppContext();
  const navigate = useNavigate();

  const logout = async () => {
    if (session) {
      await apiRequest('/auth/logout', { method: 'POST' }, session).catch(() => undefined);
    }
    setSession(null);
    navigate(getWorkspaceLoginPath(session?.user.workspace), { replace: true });
  };

  return (
    <div className="min-h-screen px-5 py-5 md:px-8 md:py-7">
      <div className="shell-panel min-h-[calc(100vh-2.5rem)] overflow-hidden p-5 md:p-6">
        <header className="flex flex-col gap-4 border-b border-black/10 pb-5 dark:border-white/10 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-ui text-xs uppercase tracking-[0.3em] text-black/40 dark:text-white/40">
              {session?.user.role}
            </p>
            <h1 className="mt-2 font-display text-3xl text-ink dark:text-white">{title}</h1>
          </div>
          <nav className="flex flex-wrap gap-2">
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                className={({ isActive }) => clsx('nav-link', isActive && 'nav-link-active')}
                to={item.to}
              >
                {item.label}
              </NavLink>
            ))}
            <ThemeToggleButton />
            <button className="button-secondary" onClick={logout}>
              Logout
            </button>
          </nav>
        </header>
        <main className="pt-6">{children}</main>
      </div>
    </div>
  );
}
