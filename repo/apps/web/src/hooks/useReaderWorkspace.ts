import { useEffect, useMemo, useState } from 'react';
import type { ReadingProfileRecord } from '@ledgerread/contracts';
import { useQuery } from '@tanstack/react-query';
import { useAppContext } from '../context/AppContext';
import { useAsyncAction } from './useAsyncAction';
import { apiRequest, graphQLRequest } from '../lib/api';
import { titleQuery } from '../lib/queries';
import { cacheEncryptedTitle, loadCachedTitle, loadLocalProfile } from '../lib/storage';
import type { TitleDetail, TitleDetailResponse } from '../lib/types';

export const getChapterBody = (
  chapter: TitleDetail['chapters'][number] | undefined,
  chineseMode: ReadingProfileRecord['preferences']['chineseMode'],
) => {
  if (!chapter) {
    return '';
  }

  if (chineseMode === 'TRADITIONAL') {
    return chapter.bodyTraditional ?? chapter.body;
  }

  return chapter.bodySimplified ?? chapter.body;
};

export const getReaderSurfaceClass = (
  activePreferences: ReadingProfileRecord['preferences'] | undefined,
) => {
  if (activePreferences?.nightMode) {
    return 'bg-[#161612] text-[#f8f4ea]';
  }

  if (activePreferences?.theme === 'linen') {
    return 'bg-[#f2ede0] text-[#231f1a]';
  }

  if (activePreferences?.theme === 'mist') {
    return 'bg-[#e8eef1] text-[#1b2830]';
  }

  if (activePreferences?.theme === 'sepia') {
    return 'bg-[#ead8bf] text-[#2e2216]';
  }

  return 'bg-[#f8f3e8] text-[#1c1b17]';
};

export const getReaderFontFamily = (
  fontFamily: ReadingProfileRecord['preferences']['fontFamily'],
) => {
  if (fontFamily === 'Noto Sans') {
    return '"Avenir Next", "Segoe UI", sans-serif';
  }

  if (fontFamily === 'Source Serif') {
    return 'Georgia, serif';
  }

  return '"Palatino Linotype", Palatino, serif';
};

export function useReaderWorkspace(titleId: string | undefined) {
  const {
    session,
    profile,
    setProfile,
    setNightMode,
    profileError,
    profileReady,
    retryProfile,
  } = useAppContext();
  const { isPending, runAction } = useAsyncAction();
  const [pageIndex, setPageIndex] = useState(0);
  const [offlineTitle, setOfflineTitle] = useState<TitleDetail | null>(null);
  const [cacheLookupComplete, setCacheLookupComplete] = useState(false);

  const title = useQuery({
    queryKey: ['title', titleId],
    enabled: Boolean(titleId && session),
    queryFn: async () => {
      const data = await graphQLRequest<TitleDetailResponse>(titleQuery, { id: titleId }, session!);
      await cacheEncryptedTitle(session!.user.username, data.title);
      return data;
    },
  });

  useEffect(() => {
    setOfflineTitle(null);
    setCacheLookupComplete(!session || !titleId);

    if (!session || !titleId) {
      return;
    }

    let cancelled = false;

    void loadCachedTitle(session.user.username, titleId)
      .then((cached) => {
        if (cancelled) {
          return;
        }

        if (cached) {
          setOfflineTitle(cached);
        }
        setCacheLookupComplete(true);
      })
      .catch(() => {
        if (!cancelled) {
          setCacheLookupComplete(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session, titleId]);

  const resolvedTitle = title.data?.title ?? offlineTitle;
  const activePreferences = profile?.preferences ?? resolvedTitle?.readingPreferences;
  const chapters = resolvedTitle?.chapters ?? [];
  const selectedChapter = chapters[Math.min(pageIndex, Math.max(chapters.length - 1, 0))];
  const titleErrorMessage =
    title.error instanceof Error ? title.error.message : 'The title could not be loaded from the local server.';
  const usingOfflineCache = Boolean(title.isError && offlineTitle);

  useEffect(() => {
    if (!session || profile || !resolvedTitle) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const local = await loadLocalProfile(session.user.username);
      if (cancelled) {
        return;
      }

      setProfile(
        local ?? {
          username: session.user.username,
          deviceLabel: 'Reader Browser',
          preferences: resolvedTitle.readingPreferences,
          updatedAt: resolvedTitle.readingPreferences.updatedAt,
        },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [profile, resolvedTitle, session, setProfile]);

  const updatePreferences = (patch: Partial<ReadingProfileRecord['preferences']>) => {
    if (!session || !profile) {
      return;
    }

    setProfile({
      ...profile,
      updatedAt: new Date().toISOString(),
      preferences: {
        ...profile.preferences,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    });
  };

  const savePreferences = async () => {
    await runAction(
      'reader-save-preferences',
      async () => {
        if (!session || !profile) {
          return { resolution: 'UPDATED' as const };
        }

        try {
          await apiRequest(
            '/profiles/me',
            {
              method: 'PUT',
              body: JSON.stringify({
                deviceLabel: profile.deviceLabel,
                preferences: profile.preferences,
              }),
            },
            session,
          );
          return { resolution: 'UPDATED' as const };
        } catch (error) {
          const typed = error as Error & {
            status?: number;
            payload?: {
              serverProfile?: {
                username: string;
                deviceLabel: string;
                preferences: ReadingProfileRecord['preferences'];
                updatedAt: string;
              };
            };
          };

          if (typed.status === 409 && typed.payload?.serverProfile) {
            setProfile({
              username: typed.payload.serverProfile.username,
              deviceLabel: typed.payload.serverProfile.deviceLabel,
              preferences: typed.payload.serverProfile.preferences,
              updatedAt: typed.payload.serverProfile.updatedAt,
            });
            return { resolution: 'SERVER_WON' as const };
          }

          throw error;
        }
      },
      {
        successMessage: (result) =>
          result.resolution === 'SERVER_WON'
            ? 'A newer server profile already existed, so the reader adopted that version.'
            : 'Reading preferences saved to the local server.',
        errorMessage: (error) =>
          error instanceof Error ? error.message : 'Reading preferences could not be saved.',
      },
    );
  };

  const readerSurfaceClass = useMemo(() => getReaderSurfaceClass(activePreferences), [activePreferences]);

  return {
    cacheLookupComplete,
    chapters,
    isPending,
    pageIndex,
    profileError,
    profileReady,
    resolvedTitle,
    retryProfile,
    runAction,
    savePreferences,
    selectedChapter,
    session,
    setNightMode,
    setPageIndex,
    title,
    titleErrorMessage,
    updatePreferences,
    usingOfflineCache,
    readerSurfaceClass,
    activePreferences,
    getReaderFontFamily,
  };
}
