import { formatReadableDateTime } from '../../lib/format';
import type { CommunityComment } from '../../lib/types';

export function CommentCard({
  comment,
  onReply,
  onReport,
  onMute,
  onBlock,
  disabled = false,
}: {
  comment: CommunityComment;
  onReply: (comment: CommunityComment) => void;
  onReport: (comment: CommunityComment) => void;
  onMute: (comment: CommunityComment) => void;
  onBlock: (comment: CommunityComment) => void;
  disabled?: boolean;
}) {
  const replies = comment.replies ?? [];

  return (
    <article className="rounded-3xl border border-black/10 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-black/5 px-3 py-1 font-ui text-[11px] uppercase tracking-[0.2em] text-black/55 dark:bg-white/10 dark:text-white/55">
              {comment.commentType === 'QUESTION' ? 'Q&A' : 'Comment'}
            </span>
            <p className="font-display text-2xl">{comment.authorName}</p>
          </div>
        </div>
        <p className="font-ui text-xs uppercase tracking-[0.18em] text-black/45 dark:text-white/45">
          {formatReadableDateTime(comment.createdAt)}
        </p>
      </div>
      <p className="mt-3 font-ui text-sm text-black/75 dark:text-white/75">{comment.visibleBody}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="button-chip" disabled={disabled} onClick={() => onReply(comment)}>
          Reply
        </button>
        <button className="button-chip" disabled={disabled} onClick={() => onReport(comment)}>
          Report
        </button>
        <button className="button-chip" disabled={disabled} onClick={() => onMute(comment)}>
          Mute
        </button>
        <button className="button-chip" disabled={disabled} onClick={() => onBlock(comment)}>
          Block
        </button>
      </div>
      {replies.length > 0 && (
        <div className="mt-4 space-y-3 border-l border-black/10 pl-4 dark:border-white/10">
          {replies.map((reply) => (
            <CommentCard
              key={reply.id}
              comment={reply}
              onReply={onReply}
              onReport={onReport}
              onMute={onMute}
              onBlock={onBlock}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </article>
  );
}
