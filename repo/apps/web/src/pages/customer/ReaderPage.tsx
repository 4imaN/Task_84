import { useParams } from 'react-router-dom';
import { PageState } from '../../components/common/PageState';
import { ReaderContentPanel } from '../../components/reader/ReaderContentPanel';
import { ReaderPreferencesPanel } from '../../components/reader/ReaderPreferencesPanel';
import { ReaderSidebar } from '../../components/reader/ReaderSidebar';
import { ReaderStatusPanels } from '../../components/reader/ReaderStatusPanels';
import { useReaderWorkspace } from '../../hooks/useReaderWorkspace';

export function ReaderPage() {
  const { titleId } = useParams();
  const reader = useReaderWorkspace(titleId);
  const resolvedTitle = reader.resolvedTitle;
  const activePreferences = reader.activePreferences;

  if (!titleId) {
    return (
      <PageState
        title="Title Not Found"
        message="Choose a title from the library before opening the reader."
      />
    );
  }

  if ((reader.title.isPending || !reader.profileReady) && !resolvedTitle) {
    return (
      <div className="grid gap-5 lg:grid-cols-[0.32fr_0.68fr]">
        <div className="skeleton h-80" />
        <div className="skeleton h-[32rem]" />
      </div>
    );
  }

  if (reader.title.isError && !resolvedTitle && reader.cacheLookupComplete) {
    if (reader.isUnreadableRoute) {
      return (
        <PageState
          title="Title Not Readable"
          message="This product is not available in the reader workspace. Open a digital title from the library instead."
        />
      );
    }

    return (
      <PageState
        title="Unable To Load Title"
        message={`${reader.titleErrorMessage} No encrypted offline copy is available on this device yet.`}
        actionLabel="Retry"
        onAction={() => void reader.title.refetch()}
      />
    );
  }

  if (!resolvedTitle || !activePreferences) {
    return (
      <PageState
        title="Reader Unavailable"
        message="The requested title could not be resolved for this session."
        actionLabel="Retry"
        onAction={() => void reader.title.refetch()}
      />
    );
  }

  if (!reader.resolvedTitleIsReadable) {
    return (
      <PageState
        title="Title Not Readable"
        message="This product is not available in the reader workspace. Open a digital title from the library instead."
      />
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.28fr_0.72fr]">
      <ReaderSidebar
        chapters={reader.chapters}
        pageIndex={reader.pageIndex}
        onSelectChapter={reader.setPageIndex}
      />

      <section className="space-y-5">
        <ReaderStatusPanels
          usingOfflineCache={reader.usingOfflineCache}
          profileError={reader.profileError}
          titleErrorMessage={reader.titleErrorMessage}
          onRetryTitle={() => void reader.title.refetch()}
          onRetryProfile={reader.retryProfile}
        />
        <ReaderPreferencesPanel
          activePreferences={activePreferences}
          isSaving={reader.isPending('reader-save-preferences')}
          onToggleNightMode={() => reader.setNightMode(!activePreferences.nightMode)}
          onSave={() => void reader.savePreferences()}
          onUpdatePreferences={reader.updatePreferences}
        />
        <ReaderContentPanel
          activePreferences={activePreferences}
          chapters={reader.chapters}
          pageIndex={reader.pageIndex}
          readerSurfaceClass={reader.readerSurfaceClass}
          resolvedTitle={resolvedTitle}
          selectedChapter={reader.selectedChapter}
          onPreviousChapter={() => reader.setPageIndex((value) => Math.max(0, value - 1))}
          onNextChapter={() =>
            reader.setPageIndex((value) => Math.min(Math.max(reader.chapters.length - 1, 0), value + 1))
          }
          getFontFamily={reader.getReaderFontFamily}
        />
      </section>
    </div>
  );
}
