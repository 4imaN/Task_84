import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReadingProfileRecord } from '@ledgerread/contracts';
import { apiRequest, setUnauthorizedHandler } from '../lib/api';
import { getTimestamp } from '../lib/format';
import { getWorkspaceHomePath, getWorkspaceLoginPath } from '../lib/routing';
import { migrateThemeStorageKey } from '../lib/storageKeys';
import { loadLocalProfile, saveLocalProfile } from '../lib/storage';
import type { AppSession, Toast } from '../lib/types';

export type AppContextValue = {
  session: AppSession | null;
  setSession: (session: AppSession | null) => void;
  sessionReady: boolean;
  profile: ReadingProfileRecord | null;
  setProfile: (profile: ReadingProfileRecord | null) => void;
  profileReady: boolean;
  profileError: string | null;
  retryProfile: () => void;
  nightMode: boolean;
  setNightMode: (nightMode: boolean) => void;
  addToast: (message: string) => void;
};

export const AppContext = createContext<AppContextValue | undefined>(undefined);

const getStoredNightMode = (username?: string) => {
  if (typeof window === 'undefined') {
    return false;
  }

  if (!username) {
    return false;
  }

  const storageKey = migrateThemeStorageKey(username);
  return window.localStorage.getItem(storageKey) === 'true';
};

const setStoredNightMode = (username: string | undefined, value: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (!username) {
    return;
  }

  const storageKey = migrateThemeStorageKey(username);
  window.localStorage.setItem(storageKey, String(value));
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AppSession | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [profile, setProfile] = useState<ReadingProfileRecord | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [nightMode, setNightModeState] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const profileInitializedRef = useRef(false);
  const authRedirectingRef = useRef(false);
  const previousUserIdRef = useRef<string | null>(null);

  const addToast = (message: string) => {
    const next = { id: crypto.randomUUID(), message };
    setToasts((current) => [...current, next]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== next.id));
    }, 3200);
  };

  useEffect(() => {
    authRedirectingRef.current = false;
  }, [session?.user.id, session?.user.role, session?.user.workspace]);

  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    const currentUserId = session?.user.id ?? null;
    const userChanged = previousUserId !== null && currentUserId !== previousUserId;
    previousUserIdRef.current = currentUserId;

    if (!session || userChanged) {
      setProfile(null);
      setProfileReady(session?.user.role !== 'CUSTOMER');
      setProfileError(null);
      profileInitializedRef.current = false;
      setNightModeState(false);
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'session-validation',
      });
    }
  }, [queryClient, session]);

  useEffect(() => {
    profileInitializedRef.current = false;
    setProfileError(null);
    setProfileReady(session?.user.role !== 'CUSTOMER');
  }, [session?.user.role, session?.user.username]);

  useEffect(() => {
    if (profile) {
      setNightModeState(Boolean(profile.preferences.nightMode));
      void saveLocalProfile(profile).catch(() => {
        addToast('Encrypted local profile cache could not be updated.');
      });
    }
  }, [addToast, profile]);

  useEffect(() => {
    if (!session || session.user.role === 'CUSTOMER') {
      return;
    }

    setNightModeState(getStoredNightMode(session.user.username));
  }, [session]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', nightMode);
    setStoredNightMode(session?.user.username, nightMode);
  }, [nightMode, session?.user.username]);

  useEffect(() => {
    const offline = () => addToast('Connection dropped. Local reading cache remains available.');
    const online = () => addToast('Local network restored. Sync and GraphQL requests are available again.');
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);

    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(
      session
        ? (status) => {
            if (authRedirectingRef.current) {
              return;
            }

            authRedirectingRef.current = true;
            const loginPath = getWorkspaceLoginPath(session.user.workspace);
            setSession(null);
            addToast(
              status === 403
                ? 'Workspace access changed. Sign in again to continue.'
                : 'Session expired. Sign in again to continue.',
            );
            navigate(loginPath, { replace: true });
          }
        : null,
    );

    return () => {
      setUnauthorizedHandler(null);
    };
  }, [navigate, session]);

  const sessionValidationQuery = useQuery({
    queryKey: ['session-validation'],
    retry: false,
    queryFn: () =>
      apiRequest<{
        user: {
          id: string;
          username: string;
          role: AppSession['user']['role'];
          workspace: AppSession['user']['workspace'];
        };
        homePath: string;
        traceId: string;
      }>('/auth/session'),
  });

  useEffect(() => {
    if (!sessionValidationQuery.data) {
      return;
    }

    const nextWorkspace = sessionValidationQuery.data.user.workspace;
    const nextHomePath = sessionValidationQuery.data.homePath ?? getWorkspaceHomePath(nextWorkspace);
    const nextSession = {
      user: sessionValidationQuery.data.user,
      homePath: nextHomePath,
    } satisfies AppSession;

    setSession((current) => {
      if (
        current?.user.id === nextSession.user.id &&
        current.user.role === nextSession.user.role &&
        current.user.workspace === nextSession.user.workspace &&
        current.homePath === nextSession.homePath
      ) {
        return current;
      }

      return nextSession;
    });
  }, [sessionValidationQuery.data]);

  useEffect(() => {
    if (!sessionValidationQuery.error) {
      return;
    }

    const error = sessionValidationQuery.error as Error & { status?: number };
    if (error.status === 401 || error.status === 403) {
      setSession(null);
      return;
    }

    addToast(error.message || 'Session validation failed while reconnecting to the local server.');
  }, [sessionValidationQuery.error]);

  const serverProfileQuery = useQuery({
    queryKey: ['profile', session?.user.username],
    enabled: Boolean(session?.user.role === 'CUSTOMER') && !sessionValidationQuery.isPending,
    queryFn: () =>
      apiRequest<{
        username: string;
        deviceLabel: string;
        preferences: ReadingProfileRecord['preferences'];
        updatedAt: string;
      }>('/profiles/me', {}, session),
  });

  useEffect(() => {
    if (!session || session.user.role !== 'CUSTOMER' || !serverProfileQuery.data || profileInitializedRef.current) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const local = await loadLocalProfile(session.user.username);
      const serverRecord: ReadingProfileRecord = {
        username: serverProfileQuery.data.username,
        deviceLabel: serverProfileQuery.data.deviceLabel,
        preferences: serverProfileQuery.data.preferences,
        updatedAt: serverProfileQuery.data.updatedAt,
      };

      const resolved =
        local && getTimestamp(local.updatedAt) > getTimestamp(serverRecord.updatedAt)
          ? local
          : serverRecord;

      if (cancelled) {
        return;
      }

      setProfile(resolved);
      setProfileError(null);
      setProfileReady(true);
      profileInitializedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [serverProfileQuery.data, session]);

  useEffect(() => {
    if (!session || session.user.role !== 'CUSTOMER' || !serverProfileQuery.error || profileInitializedRef.current) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const local = await loadLocalProfile(session.user.username);
      if (cancelled) {
        return;
      }

      if (local) {
        setProfile(local);
        setProfileError('The local server profile could not be reached, so the encrypted profile cache is being used.');
      } else {
        setProfile(null);
        setProfileError(
          serverProfileQuery.error instanceof Error
            ? serverProfileQuery.error.message
            : 'The reading profile could not be loaded from the local server.',
        );
      }

      setProfileReady(true);
      profileInitializedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [serverProfileQuery.error, session]);

  const retryProfile = () => {
    if (!session || session.user.role !== 'CUSTOMER') {
      return;
    }

    profileInitializedRef.current = false;
    setProfileError(null);
    setProfileReady(false);
    void serverProfileQuery.refetch();
  };

  const updateNightMode = (next: boolean) => {
    setNightModeState(next);

    if (!profile) {
      return;
    }

    const nextUpdatedAt = new Date().toISOString();
    setProfile({
      ...profile,
      updatedAt: nextUpdatedAt,
      preferences: {
        ...profile.preferences,
        nightMode: next,
        updatedAt: nextUpdatedAt,
      },
    });
  };

  const sessionReady = sessionValidationQuery.isPending
    ? false
    : sessionValidationQuery.isSuccess
      ? Boolean(session)
      : true;

  const value: AppContextValue = {
    session,
    setSession,
    sessionReady,
    profile,
    setProfile,
    profileReady,
    profileError,
    retryProfile,
    nightMode,
    setNightMode: updateNightMode,
    addToast,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-full max-w-sm flex-col gap-3 px-4">
        {toasts.map((toast) => (
          <div key={toast.id} className="shell-panel pointer-events-auto p-4 text-sm font-medium">
            {toast.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('App context is unavailable.');
  }

  return context;
}
