import { CommentCard } from './CommentCard';
import type { CommunityComment } from '../../lib/types';

type CommunityThreadPanelProps = {
  comments: CommunityComment[];
  onReply: (target: CommunityComment) => void;
  onReport: (target: CommunityComment) => void;
  onMute: (target: CommunityComment) => void;
  onBlock: (target: CommunityComment) => void;
  isPending: (key: string) => boolean;
};

export function CommunityThreadPanel({
  comments,
  onReply,
  onReport,
  onMute,
  onBlock,
  isPending,
}: CommunityThreadPanelProps) {
  return (
    <section className="shell-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">Thread</p>
          <p className="mt-2 font-ui text-sm text-black/60 dark:text-white/60">
            Moderation-safe discussion, Q&amp;A prompts, and viewer-aware masking all render locally.
          </p>
        </div>
        <div className="rounded-full border border-black/10 px-4 py-2 font-ui text-xs uppercase tracking-[0.2em] text-black/45 dark:border-white/10 dark:text-white/45">
          {comments.length} top-level posts
        </div>
      </div>
      <div className="mt-5 space-y-4">
        {comments.map((comment) => (
          <CommentCard
            key={comment.id}
            comment={comment}
            onReply={onReply}
            onReport={onReport}
            onMute={onMute}
            onBlock={onBlock}
            disabled={
              isPending('community-comment') ||
              isPending('community-report') ||
              isPending(`community-mute-${comment.authorId}`) ||
              isPending(`community-block-${comment.authorId}`)
            }
          />
        ))}
        {comments.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-black/10 px-5 py-8 font-ui text-sm text-black/55 dark:border-white/10 dark:text-white/55">
            No local discussion yet for this title. Start the thread with a comment or a Q&amp;A prompt.
          </div>
        ) : null}
      </div>
    </section>
  );
}
