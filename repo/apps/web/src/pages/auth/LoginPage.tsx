import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Workspace } from '@ledgerread/contracts';
import { useAppContext } from '../../context/AppContext';
import { apiRequest } from '../../lib/api';
import { getWorkspaceLoginPath } from '../../lib/routing';
import type { AppSession } from '../../lib/types';

export function LoginPage({ workspace, headline }: { workspace: Workspace; headline: string }) {
  const { session, setSession, sessionReady, addToast } = useAppContext();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (sessionReady && session && session.user.workspace === workspace) {
      navigate(session.homePath, { replace: true });
    }
  }, [navigate, session, sessionReady, workspace]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      const nextSession = await apiRequest<AppSession>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, workspace }),
      });
      setSession(nextSession);
      addToast(`Signed into the ${workspace.toUpperCase()} workspace.`);
      navigate(nextSession.homePath, { replace: true });
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="grid w-full max-w-5xl gap-6 md:grid-cols-[1.15fr_0.85fr]">
        <section className="shell-panel overflow-hidden p-8 md:p-12">
          <div className="max-w-xl">
            <p className="font-ui text-xs uppercase tracking-[0.35em] text-black/45 dark:text-white/45">
              LedgerRead Commerce & Compliance
            </p>
            <h1 className="mt-6 font-display text-5xl leading-tight text-ink dark:text-white md:text-6xl">
              {headline}
            </h1>
            <p className="mt-6 max-w-lg font-ui text-base text-black/65 dark:text-white/65">
              Separate logins, separate route trees, and server-verified role ownership keep customer reading,
              moderation, checkout, and audit workspaces isolated even on a local offline network.
            </p>
          </div>
        </section>

        <section className="shell-panel p-8">
          <p className="font-ui text-sm uppercase tracking-[0.3em] text-black/45 dark:text-white/45">
            Sign In
          </p>
          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            <input
              autoComplete="username"
              className="field"
              placeholder="Username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <input
              autoComplete="current-password"
              className="field"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button className="button-primary w-full" disabled={submitting}>
              {submitting ? 'Signing In...' : 'Continue'}
            </button>
          </form>
          <p className="mt-5 font-ui text-xs text-black/45 dark:text-white/45">
            Customer: {getWorkspaceLoginPath('app')}, Clerk: {getWorkspaceLoginPath('pos')}, Moderator:{' '}
            {getWorkspaceLoginPath('mod')}, Manager: {getWorkspaceLoginPath('admin')}, Finance:{' '}
            {getWorkspaceLoginPath('finance')}
          </p>
        </section>
      </div>
    </div>
  );
}
