import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryBoundary } from '../../components/common/QueryBoundary';
import { useAppContext } from '../../context/AppContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { formatReadableDateTime } from '../../lib/format';
import { apiRequest } from '../../lib/api';
import type { QueueItem } from '../../lib/types';

type QueueStatus = 'OPEN' | 'RESOLVED';

export function ModeratorQueuePage() {
  const { session } = useAppContext();
  const { isPending, runAction } = useAsyncAction();
  const [status, setStatus] = useState<QueueStatus>('OPEN');
  const queue = useQuery({
    queryKey: ['moderation-queue', status],
    queryFn: () => apiRequest<QueueItem[]>(`/moderation/queue?status=${status}`, {}, session),
  });

  const moderate = async (item: QueueItem, action: 'hide' | 'remove' | 'suspend' | 'restore') => {
    await runAction(
      `moderation-${item.id}-${action}`,
      async () => {
        await apiRequest(
          '/moderation/actions',
          {
            method: 'POST',
            body: JSON.stringify({
              reportId: item.id,
              targetCommentId: item.comment_id,
              action,
              notes: `${action} from moderator queue`,
            }),
          },
          session,
        );
        await queue.refetch();
        return true;
      },
      {
        successMessage: `Moderation action applied: ${action}.`,
        errorMessage: (error) =>
          error instanceof Error ? error.message : `Moderation action ${action} failed.`,
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {(['OPEN', 'RESOLVED'] as const).map((tab) => (
          <button
            key={tab}
            className={tab === status ? 'button-primary' : 'button-secondary'}
            onClick={() => setStatus(tab)}
            type="button"
          >
            {tab === 'OPEN' ? 'Open Queue' : 'Resolved'}
          </button>
        ))}
      </div>

      <QueryBoundary
        isPending={queue.isPending}
        isError={queue.isError}
        isEmpty={(queue.data?.length ?? 0) === 0}
        emptyTitle={status === 'OPEN' ? 'Queue Clear' : 'No Resolved Items'}
        emptyMessage={
          status === 'OPEN'
            ? 'No open reports are waiting for moderation.'
            : 'No resolved moderation records are currently eligible for restore review.'
        }
        errorMessage="The moderation queue could not be loaded right now."
        onRetry={() => void queue.refetch()}
        loading={<div className="skeleton h-80" />}
      >
        {(queue.data ?? []).map((item) => (
          <article key={item.id} className="shell-panel p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">
                  {item.category} · reported by {item.reporter_name}
                </p>
                <h2 className="mt-3 font-display text-4xl">{item.title_name ?? 'Unscoped content'}</h2>
                <p className="mt-3 font-ui text-sm text-black/70 dark:text-white/70">{item.comment_body}</p>
                <p className="mt-3 font-ui text-sm text-black/55 dark:text-white/55">
                  Author: {item.comment_author_name ?? 'Unknown'} · Status: {item.status} ·{' '}
                  {formatReadableDateTime(item.created_at)}
                </p>
                <p className="mt-2 font-ui text-xs text-black/45 dark:text-white/45">{item.notes}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                {status === 'OPEN' ? (
                  <>
                    <button
                      className="button-secondary"
                      disabled={isPending(`moderation-${item.id}-hide`)}
                      onClick={() => moderate(item, 'hide')}
                    >
                      Hide
                    </button>
                    <button
                      className="button-secondary"
                      disabled={isPending(`moderation-${item.id}-remove`)}
                      onClick={() => moderate(item, 'remove')}
                    >
                      Remove
                    </button>
                    <button
                      className="button-primary"
                      disabled={isPending(`moderation-${item.id}-suspend`)}
                      onClick={() => moderate(item, 'suspend')}
                    >
                      Suspend
                    </button>
                  </>
                ) : (
                  <button
                    className="button-primary"
                    disabled={!item.comment_hidden || isPending(`moderation-${item.id}-restore`)}
                    onClick={() => moderate(item, 'restore')}
                  >
                    Restore
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </QueryBoundary>
    </div>
  );
}
