import type { CommunityComment, TitleCard } from '../../lib/types';

type CommunityDeskPanelProps = {
  allTitles: TitleCard[];
  titleId: string;
  onTitleChange: (titleId: string) => void;
  activeTitle: TitleCard | null;
  totalRatings: number;
  averageRating: number;
  favoriteActive: boolean;
  authorSubscribed: boolean;
  seriesSubscribed: boolean;
  onToggleFavorite: () => void;
  onToggleAuthorSubscription: () => void;
  onToggleSeriesSubscription: () => void;
  commentType: 'COMMENT' | 'QUESTION';
  onCommentTypeChange: (value: 'COMMENT' | 'QUESTION') => void;
  rating: number;
  onRatingChange: (value: number) => void;
  replyTarget: CommunityComment | null;
  onClearReply: () => void;
  commentBody: string;
  onCommentBodyChange: (value: string) => void;
  onSubmitComment: () => void;
  onSubmitRating: () => void;
  isPending: (key: string) => boolean;
};

export function CommunityDeskPanel({
  allTitles,
  titleId,
  onTitleChange,
  activeTitle,
  totalRatings,
  averageRating,
  favoriteActive,
  authorSubscribed,
  seriesSubscribed,
  onToggleFavorite,
  onToggleAuthorSubscription,
  onToggleSeriesSubscription,
  commentType,
  onCommentTypeChange,
  rating,
  onRatingChange,
  replyTarget,
  onClearReply,
  commentBody,
  onCommentBodyChange,
  onSubmitComment,
  onSubmitRating,
  isPending,
}: CommunityDeskPanelProps) {
  return (
    <div className="shell-panel p-6">
      <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">
        Community Desk
      </p>
      <select className="field mt-5" value={titleId} onChange={(event) => onTitleChange(event.target.value)}>
        {allTitles.map((title) => (
          <option key={title.id} value={title.id}>
            {title.name}
          </option>
        ))}
      </select>

      {activeTitle ? (
        <div className="mt-5 rounded-[1.75rem] bg-ink px-5 py-5 text-white">
          <p className="font-ui text-xs uppercase tracking-[0.25em] text-white/55">{activeTitle.authorName}</p>
          <h2 className="mt-3 font-display text-4xl">{activeTitle.name}</h2>
          <p className="mt-3 font-ui text-sm text-white/70">
            {totalRatings} ratings · {averageRating.toFixed(1)} average
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="button-chip border-white/20 bg-white/10 text-white"
              disabled={isPending('community-favorite')}
              onClick={onToggleFavorite}
            >
              {favoriteActive ? 'Unfavorite' : 'Favorite'}
            </button>
            <button
              className="button-chip border-white/20 bg-white/10 text-white"
              disabled={isPending(`community-author-${activeTitle.authorId}`)}
              onClick={onToggleAuthorSubscription}
            >
              {authorSubscribed ? 'Unfollow Author' : 'Follow Author'}
            </button>
            <button
              className="button-chip border-white/20 bg-white/10 text-white"
              disabled={Boolean(activeTitle.seriesId) && isPending(`community-series-${activeTitle.seriesId}`)}
              onClick={onToggleSeriesSubscription}
            >
              {seriesSubscribed ? 'Unfollow Series' : 'Follow Series'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <select
          className="field"
          value={commentType}
          onChange={(event) => onCommentTypeChange(event.target.value as 'COMMENT' | 'QUESTION')}
        >
          <option value="COMMENT">Discussion Comment</option>
          <option value="QUESTION">Q&amp;A Question</option>
        </select>
        <select className="field" value={rating} onChange={(event) => onRatingChange(Number(event.target.value))}>
          {[1, 2, 3, 4, 5].map((value) => (
            <option key={value} value={value}>
              {value} star{value > 1 ? 's' : ''}
            </option>
          ))}
        </select>
      </div>

      {replyTarget ? (
        <div className="mt-4 rounded-3xl border border-black/10 bg-black/5 px-4 py-3 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-ui text-xs uppercase tracking-[0.2em] text-black/45 dark:text-white/45">
                Replying To
              </p>
              <p className="mt-2 font-ui text-sm text-black/70 dark:text-white/70">
                {replyTarget.authorName}: {replyTarget.visibleBody}
              </p>
            </div>
            <button className="button-secondary" disabled={isPending('community-comment')} onClick={onClearReply}>
              Clear
            </button>
          </div>
        </div>
      ) : null}

      <textarea
        className="field mt-4 min-h-36"
        placeholder="Share a thought, ask a question, or answer a thread..."
        value={commentBody}
        onChange={(event) => onCommentBodyChange(event.target.value)}
      />
      <div className="mt-4 flex flex-wrap gap-3">
        <button className="button-primary" disabled={isPending('community-comment')} onClick={onSubmitComment}>
          {isPending('community-comment')
            ? 'Posting...'
            : replyTarget
              ? 'Post Reply'
              : commentType === 'QUESTION'
                ? 'Post Question'
                : 'Post Comment'}
        </button>
        <button className="button-secondary" disabled={isPending('community-rating')} onClick={onSubmitRating}>
          {isPending('community-rating') ? 'Saving...' : 'Save Rating'}
        </button>
      </div>
    </div>
  );
}
