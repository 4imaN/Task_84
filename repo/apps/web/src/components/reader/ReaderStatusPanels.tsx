type ReaderStatusPanelsProps = {
  usingOfflineCache: boolean;
  profileError: string | null;
  titleErrorMessage: string;
  onRetryTitle: () => void;
  onRetryProfile: () => void;
};

export function ReaderStatusPanels({
  usingOfflineCache,
  profileError,
  titleErrorMessage,
  onRetryTitle,
  onRetryProfile,
}: ReaderStatusPanelsProps) {
  return (
    <>
      {usingOfflineCache ? (
        <div className="shell-panel border border-dashed border-brass/40 bg-brass/10 p-5">
          <p className="font-ui text-xs uppercase tracking-[0.22em] text-black/45 dark:text-white/45">
            Offline Reading Cache
          </p>
          <p className="mt-2 font-ui text-sm text-black/70 dark:text-white/70">
            The local server copy is unavailable, so this title is being rendered from the encrypted IndexedDB cache.
          </p>
          <button className="button-secondary mt-4" onClick={onRetryTitle} type="button">
            Retry Server Fetch
          </button>
          <p className="mt-2 font-ui text-xs text-black/45 dark:text-white/45">{titleErrorMessage}</p>
        </div>
      ) : null}
      {profileError ? (
        <div className="shell-panel border border-dashed border-black/10 p-5 dark:border-white/10">
          <p className="font-ui text-xs uppercase tracking-[0.22em] text-black/45 dark:text-white/45">
            Profile Recovery
          </p>
          <p className="mt-2 font-ui text-sm text-black/70 dark:text-white/70">{profileError}</p>
          <button className="button-secondary mt-4" onClick={onRetryProfile} type="button">
            Retry Profile Load
          </button>
        </div>
      ) : null}
    </>
  );
}
