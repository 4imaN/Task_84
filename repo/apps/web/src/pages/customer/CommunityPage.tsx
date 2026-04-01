import { QueryBoundary } from '../../components/common/QueryBoundary';
import { CommunityDeskPanel } from '../../components/community/CommunityDeskPanel';
import { CommunityReportPanel } from '../../components/community/CommunityReportPanel';
import { CommunityThreadPanel } from '../../components/community/CommunityThreadPanel';
import { useCommunityWorkspace } from '../../hooks/useCommunityWorkspace';

export function CommunityPage() {
  const workspace = useCommunityWorkspace();

  return (
    <QueryBoundary
      isPending={workspace.catalog.isPending || (Boolean(workspace.titleId) && workspace.thread.isPending)}
      isError={workspace.catalog.isError || workspace.thread.isError}
      isEmpty={workspace.isCatalogEmpty}
      emptyTitle="Community Empty"
      emptyMessage="No local titles are ready for community activity yet."
      errorMessage="Community data could not be loaded from the local server."
      onRetry={() => {
        void workspace.catalog.refetch();
        void workspace.thread.refetch();
      }}
      loading={
        <div className="grid gap-5 xl:grid-cols-[0.42fr_0.58fr]">
          <div className="skeleton h-[40rem]" />
          <div className="skeleton h-[40rem]" />
        </div>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[0.42fr_0.58fr]">
        <section className="space-y-5">
          <CommunityDeskPanel
            allTitles={workspace.allTitles}
            titleId={workspace.titleId}
            onTitleChange={workspace.setTitleId}
            activeTitle={workspace.activeTitle}
            totalRatings={workspace.thread.data?.communityThread.totalRatings ?? 0}
            averageRating={workspace.thread.data?.communityThread.averageRating ?? 0}
            favoriteActive={workspace.favoriteActive}
            authorSubscribed={workspace.authorSubscribed}
            seriesSubscribed={workspace.seriesSubscribed}
            onToggleFavorite={workspace.toggleFavorite}
            onToggleAuthorSubscription={workspace.toggleAuthorSubscription}
            onToggleSeriesSubscription={workspace.toggleSeriesSubscription}
            commentType={workspace.commentType}
            onCommentTypeChange={workspace.setCommentType}
            rating={workspace.rating}
            onRatingChange={workspace.setRating}
            replyTarget={workspace.replyTarget}
            onClearReply={workspace.clearReply}
            commentBody={workspace.commentBody}
            onCommentBodyChange={workspace.setCommentBody}
            onSubmitComment={workspace.submitComment}
            onSubmitRating={workspace.submitRating}
            isPending={workspace.isPending}
          />

          {workspace.reportTarget ? (
            <CommunityReportPanel
              reportTarget={workspace.reportTarget}
              reportCategory={workspace.reportCategory}
              onReportCategoryChange={workspace.setReportCategory}
              reportNotes={workspace.reportNotes}
              onReportNotesChange={workspace.setReportNotes}
              onCancel={workspace.cancelReport}
              onSubmit={workspace.submitReport}
              isPending={workspace.isPending('community-report')}
            />
          ) : null}
        </section>

        <CommunityThreadPanel
          comments={workspace.comments}
          onReply={workspace.startReply}
          onReport={workspace.startReport}
          onMute={(target) => workspace.updateRelationship('mute', target.authorId, target.authorName)}
          onBlock={(target) => workspace.updateRelationship('block', target.authorId, target.authorName)}
          isPending={workspace.isPending}
        />
      </div>
    </QueryBoundary>
  );
}
