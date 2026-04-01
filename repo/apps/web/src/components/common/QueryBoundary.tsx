import type { ReactNode } from 'react';
import { PageState } from './PageState';

export function QueryBoundary({
  isPending,
  isError,
  isEmpty,
  loading,
  emptyTitle,
  emptyMessage,
  errorMessage,
  onRetry,
  children,
}: {
  isPending: boolean;
  isError: boolean;
  isEmpty?: boolean;
  loading?: ReactNode;
  emptyTitle?: string;
  emptyMessage?: string;
  errorMessage?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (isPending) {
    return <>{loading ?? <div className="skeleton h-48" />}</>;
  }

  if (isError) {
    return (
      <PageState
        title="Unable To Load"
        message={errorMessage ?? 'The local service could not return this view right now.'}
        actionLabel={onRetry ? 'Retry' : undefined}
        onAction={onRetry}
      />
    );
  }

  if (isEmpty) {
    return (
      <PageState
        title={emptyTitle ?? 'Nothing Here Yet'}
        message={emptyMessage ?? 'No data is available for this view yet.'}
      />
    );
  }

  return <>{children}</>;
}
