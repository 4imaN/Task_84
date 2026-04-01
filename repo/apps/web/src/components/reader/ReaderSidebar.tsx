import clsx from 'clsx';
import type { TitleDetail } from '../../lib/types';

export function ReaderSidebar({
  chapters,
  pageIndex,
  onSelectChapter,
}: {
  chapters: TitleDetail['chapters'];
  pageIndex: number;
  onSelectChapter: (index: number) => void;
}) {
  return (
    <aside className="shell-panel p-5">
      <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">
        Table Of Contents
      </p>
      <div className="mt-5 space-y-2">
        {chapters.map((chapter, index) => (
          <button
            key={chapter.id}
            className={clsx(
              'w-full rounded-2xl px-4 py-3 text-left transition',
              index === pageIndex ? 'bg-ink text-white' : 'hover:bg-black/5 dark:hover:bg-white/5',
            )}
            onClick={() => onSelectChapter(index)}
          >
            <span className="block font-ui text-xs uppercase tracking-[0.2em] opacity-55">Chapter {chapter.order}</span>
            <span className="block pt-1 font-display text-2xl">{chapter.name}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
