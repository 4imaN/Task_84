import clsx from 'clsx';

export function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={clsx('shell-panel p-6', accent && 'bg-ink text-white dark:bg-white dark:text-black')}>
      <p
        className={clsx(
          'font-ui text-xs uppercase tracking-[0.25em]',
          accent ? 'text-white/60 dark:text-black/45' : 'text-black/45 dark:text-white/45',
        )}
      >
        {label}
      </p>
      <p className="mt-4 font-display text-4xl">{value}</p>
    </div>
  );
}
