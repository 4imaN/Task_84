export function PageState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
}) {
  return (
    <div className="shell-panel p-6">
      <p className="font-ui text-xs uppercase tracking-[0.24em] text-black/45 dark:text-white/45">{title}</p>
      <p className="mt-3 font-ui text-sm text-black/65 dark:text-white/65">{message}</p>
      {actionLabel && onAction ? (
        <button className="button-secondary mt-4" onClick={onAction} type="button">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
