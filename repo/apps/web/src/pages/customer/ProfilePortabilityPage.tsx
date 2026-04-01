import { useState, type ChangeEvent } from 'react';
import { decryptJson, encryptJson, type CipherPayload } from '@ledgerread/crypto';
import type { ReadingProfileRecord } from '@ledgerread/contracts';
import { PageState } from '../../components/common/PageState';
import { useAppContext } from '../../context/AppContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { apiRequest } from '../../lib/api';
import { formatReadableDateTime, getTimestamp } from '../../lib/format';

export function ProfilePortabilityPage() {
  const { session, profile, setProfile, profileReady, profileError, retryProfile } = useAppContext();
  const { isPending, runAction } = useAsyncAction();
  const [password, setPassword] = useState('');

  if (!session) {
    return (
      <PageState
        title="Session Required"
        message="Sign in again to load your reading profile."
      />
    );
  }

  if (!profileReady) {
    return <div className="skeleton h-64" />;
  }

  if (!profile) {
    return (
      <PageState
        title="Unable To Load Profile"
        message={
          profileError ??
          'The reading profile could not be loaded from the local server or encrypted device cache.'
        }
        actionLabel="Retry"
        onAction={retryProfile}
      />
    );
  }

  const exportProfile = async () => {
    await runAction(
      'profile-export',
      async () => {
        const encrypted = await encryptJson(password, profile);
        const blob = new Blob([JSON.stringify(encrypted, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${profile.username}-reading-profile.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        return true;
      },
      {
        successMessage: 'Encrypted reading profile exported.',
        errorMessage: (error) =>
          error instanceof Error ? error.message : 'Profile export failed.',
      },
    );
  };

  const importProfile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await runAction(
      'profile-import',
      async () => {
        let raw: CipherPayload;

        try {
          raw = JSON.parse(await file.text()) as CipherPayload;
        } catch {
          throw new Error('The selected file is not valid JSON.');
        }

        let imported: ReadingProfileRecord;
        try {
          imported = await decryptJson<ReadingProfileRecord>(password, raw);
        } catch {
          throw new Error('The import password is incorrect or the file is not a valid LedgerRead profile.');
        }

        if (getTimestamp(imported.updatedAt) <= getTimestamp(profile.updatedAt)) {
          return { resolution: 'CURRENT_WON' as const };
        }

        const response = await apiRequest<{
          resolution: 'CREATED' | 'CLIENT_WON' | 'SERVER_WON';
          profile: {
            username: string;
            deviceLabel: string;
            preferences: ReadingProfileRecord['preferences'];
            updatedAt: string;
          };
        }>(
          '/profiles/me/sync',
          {
            method: 'POST',
            body: JSON.stringify({
              deviceLabel: imported.deviceLabel,
              preferences: imported.preferences,
              strict: false,
            }),
          },
          session,
        );
        const resolvedProfile = {
          username: response.profile.username,
          deviceLabel: response.profile.deviceLabel,
          preferences: response.profile.preferences,
          updatedAt: response.profile.updatedAt,
        } satisfies ReadingProfileRecord;
        setProfile(resolvedProfile);
        return { resolution: response.resolution as 'CREATED' | 'CLIENT_WON' | 'SERVER_WON' };
      },
      {
        successMessage: (result) =>
          result.resolution === 'CURRENT_WON'
            ? 'Imported profile was older than the active local profile, so the current settings were kept.'
            : result.resolution === 'SERVER_WON'
              ? 'A newer server profile already existed, so the imported file was not applied.'
              : 'Reading profile imported and saved.',
        errorMessage: (error) =>
          error instanceof Error ? error.message : 'Reading profile import failed.',
      },
    );

    event.target.value = '';
  };

  const lanSync = async () => {
    await runAction(
      'profile-sync',
      async () => {
        try {
          const response = await apiRequest<{
            resolution: string;
            profile: {
              username: string;
              deviceLabel: string;
              preferences: ReadingProfileRecord['preferences'];
              updatedAt: string;
            };
          }>(
            '/profiles/me/sync',
            {
              method: 'POST',
              body: JSON.stringify({
                deviceLabel: profile.deviceLabel,
                preferences: profile.preferences,
                strict: true,
              }),
            },
            session,
          );
          setProfile({
            username: response.profile.username,
            deviceLabel: response.profile.deviceLabel,
            preferences: response.profile.preferences,
            updatedAt: response.profile.updatedAt,
          });
          return { resolution: response.resolution, adoptedServer: false };
        } catch (error) {
          const typed = error as Error & { status?: number; payload?: any };
          if (typed.status === 409 && typed.payload?.serverProfile) {
            const serverProfile = typed.payload.serverProfile;
            setProfile({
              username: serverProfile.username,
              deviceLabel: serverProfile.deviceLabel,
              preferences: serverProfile.preferences,
              updatedAt: serverProfile.updatedAt,
            });
            return { resolution: 'SERVER_NEWER', adoptedServer: true };
          }
          throw error;
        }
      },
      {
        successMessage: (result) =>
          result.adoptedServer
            ? 'Server profile was newer, so the local view adopted the server version.'
            : `LAN sync completed: ${result.resolution}.`,
        errorMessage: (error) => (error instanceof Error ? error.message : 'LAN sync failed.'),
      },
    );
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[0.44fr_0.56fr]">
      <div className="space-y-5">
        {profileError ? (
          <div className="shell-panel border border-dashed border-brass/40 bg-brass/10 p-5">
            <p className="font-ui text-xs uppercase tracking-[0.22em] text-black/45 dark:text-white/45">
              Profile Recovery Mode
            </p>
            <p className="mt-2 font-ui text-sm text-black/70 dark:text-white/70">{profileError}</p>
            <button className="button-secondary mt-4" onClick={retryProfile} type="button">
              Retry Profile Load
            </button>
          </div>
        ) : null}

        <section className="shell-panel p-6">
          <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">
            Encryption Password
          </p>
          <input
            className="field mt-5"
            type="password"
            placeholder="Create a one-time export password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="button-primary" onClick={exportProfile} disabled={!password || isPending('profile-export')}>
              {isPending('profile-export') ? 'Exporting...' : 'Export Profile'}
            </button>
            <label className="button-secondary cursor-pointer">
              {isPending('profile-import') ? 'Importing...' : 'Import Profile'}
              <input
                className="hidden"
                disabled={!password || isPending('profile-import')}
                type="file"
                accept="application/json"
                onChange={importProfile}
              />
            </label>
            <button className="button-secondary" disabled={isPending('profile-sync')} onClick={lanSync}>
              {isPending('profile-sync') ? 'Syncing...' : 'LAN Sync'}
            </button>
          </div>
        </section>
      </div>

      <section className="shell-panel p-6">
        <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">
          Profile Summary
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-3xl border border-black/10 px-4 py-4 dark:border-white/10">
            <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-black/45 dark:text-white/45">Device</p>
            <p className="mt-2 font-display text-2xl">{profile.deviceLabel}</p>
          </div>
          <div className="rounded-3xl border border-black/10 px-4 py-4 dark:border-white/10">
            <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-black/45 dark:text-white/45">Last Updated</p>
            <p className="mt-2 font-ui text-sm text-black/75 dark:text-white/75">{formatReadableDateTime(profile.updatedAt)}</p>
          </div>
          <div className="rounded-3xl border border-black/10 px-4 py-4 dark:border-white/10">
            <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-black/45 dark:text-white/45">Typography</p>
            <p className="mt-2 font-ui text-sm text-black/75 dark:text-white/75">
              {profile.preferences.fontFamily} · {profile.preferences.fontSize} pt · {profile.preferences.lineSpacing.toFixed(1)} line spacing
            </p>
          </div>
          <div className="rounded-3xl border border-black/10 px-4 py-4 dark:border-white/10">
            <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-black/45 dark:text-white/45">Reading Mode</p>
            <p className="mt-2 font-ui text-sm text-black/75 dark:text-white/75">
              {profile.preferences.readerMode === 'SCROLL' ? 'Continuous Scroll' : 'Pagination'} · {profile.preferences.theme} theme
            </p>
          </div>
          <div className="rounded-3xl border border-black/10 px-4 py-4 dark:border-white/10">
            <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-black/45 dark:text-white/45">Language</p>
            <p className="mt-2 font-ui text-sm text-black/75 dark:text-white/75">
              {profile.preferences.chineseMode === 'TRADITIONAL' ? 'Traditional Chinese' : 'Simplified Chinese'}
            </p>
          </div>
          <div className="rounded-3xl border border-black/10 px-4 py-4 dark:border-white/10">
            <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-black/45 dark:text-white/45">Global Night Mode</p>
            <p className="mt-2 font-ui text-sm text-black/75 dark:text-white/75">
              {profile.preferences.nightMode ? 'Enabled across the workspace' : 'Currently off'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
