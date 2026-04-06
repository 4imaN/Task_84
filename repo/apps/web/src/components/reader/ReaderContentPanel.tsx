import clsx from 'clsx';
import { currency } from '../../lib/format';
import type { TitleDetail } from '../../lib/types';
import { getChapterBody } from '../../hooks/useReaderWorkspace';

type ReaderContentPanelProps = {
  activePreferences: TitleDetail['readingPreferences'];
  chapters: TitleDetail['chapters'];
  pageIndex: number;
  readerSurfaceClass: string;
  resolvedTitle: TitleDetail;
  selectedChapter: TitleDetail['chapters'][number] | undefined;
  onPreviousChapter: () => void;
  onNextChapter: () => void;
  getFontFamily: (fontFamily: TitleDetail['readingPreferences']['fontFamily']) => string;
};

export function ReaderContentPanel({
  activePreferences,
  chapters,
  pageIndex,
  readerSurfaceClass,
  resolvedTitle,
  selectedChapter,
  onPreviousChapter,
  onNextChapter,
  getFontFamily,
}: ReaderContentPanelProps) {
  return (
    <article className="shell-panel overflow-hidden">
      <header className="border-b border-black/10 px-6 py-5 dark:border-white/10">
        <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">
          {resolvedTitle.authorName}
        </p>
        <h2 className="mt-3 font-display text-5xl">{resolvedTitle.name}</h2>
        <p className="mt-3 font-ui text-sm text-black/60 dark:text-white/60">
          {currency(resolvedTitle.price)} · {resolvedTitle.averageRating.toFixed(1)} avg rating
        </p>
      </header>
      <div className="grid gap-6 px-6 py-8 xl:grid-cols-[0.22fr_0.78fr]">
        {activePreferences.readerMode === 'PAGINATION' ? (
          <div className="space-y-3">
            <button className="button-secondary w-full" onClick={onPreviousChapter}>
              Previous Chapter
            </button>
            <button className="button-primary w-full" onClick={onNextChapter}>
              Next Chapter
            </button>
            <p className="font-ui text-xs uppercase tracking-[0.18em] text-black/45 dark:text-white/45">
              Chapter {Math.min(pageIndex + 1, Math.max(chapters.length, 1))} of {Math.max(chapters.length, 1)}
            </p>
          </div>
        ) : (
          <div className="rounded-3xl border border-black/10 p-4 font-ui text-sm text-black/55 dark:border-white/10 dark:text-white/55">
            Continuous scroll is active, so the full chapter set is rendered as one reading stream.
          </div>
        )}

        <div
          data-testid="reader-content-surface"
          className={clsx('rounded-[2rem] px-4 py-2', readerSurfaceClass)}
          style={{
            fontSize: `${activePreferences.fontSize}pt`,
            lineHeight: String(activePreferences.lineSpacing),
            fontFamily: getFontFamily(activePreferences.fontFamily),
          }}
        >
          {activePreferences.readerMode === 'PAGINATION' ? (
            <div>
              <h3 className="mb-5 font-display text-3xl">{selectedChapter?.name}</h3>
              <p className="whitespace-pre-wrap">{getChapterBody(selectedChapter, activePreferences.chineseMode)}</p>
            </div>
          ) : (
            <div className="space-y-8">
              {chapters.map((chapter) => (
                <section key={chapter.id}>
                  <h3 className="mb-4 font-display text-3xl">{chapter.name}</h3>
                  <p className="whitespace-pre-wrap">{getChapterBody(chapter, activePreferences.chineseMode)}</p>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
