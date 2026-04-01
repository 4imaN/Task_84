import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppContext } from '../context/AppContext';
import { useAsyncAction } from './useAsyncAction';
import { apiRequest, graphQLRequest } from '../lib/api';
import { catalogQuery, communityQuery } from '../lib/queries';
import type { CatalogResponse, CommunityComment, CommunityThreadResponse } from '../lib/types';

export function useCommunityWorkspace() {
  const { session, addToast } = useAppContext();
  const { isPending, runAction } = useAsyncAction();
  const [titleId, setTitleId] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [commentType, setCommentType] = useState<'COMMENT' | 'QUESTION'>('COMMENT');
  const [rating, setRating] = useState(5);
  const [favoriteActive, setFavoriteActive] = useState(false);
  const [authorSubscribed, setAuthorSubscribed] = useState(false);
  const [seriesSubscribed, setSeriesSubscribed] = useState(false);
  const [replyTarget, setReplyTarget] = useState<CommunityComment | null>(null);
  const [reportTarget, setReportTarget] = useState<CommunityComment | null>(null);
  const [reportCategory, setReportCategory] = useState('ABUSE');
  const [reportNotes, setReportNotes] = useState('');

  const catalog = useQuery({
    queryKey: ['catalog'],
    queryFn: () => graphQLRequest<CatalogResponse>(catalogQuery, undefined, session!),
  });

  useEffect(() => {
    if (!titleId && catalog.data?.catalog.featured[0]?.id) {
      setTitleId(catalog.data.catalog.featured[0].id);
    }
  }, [catalog.data, titleId]);

  const thread = useQuery({
    queryKey: ['thread', titleId],
    enabled: Boolean(titleId),
    queryFn: () => graphQLRequest<CommunityThreadResponse>(communityQuery, { titleId }, session!),
  });

  useEffect(() => {
    if (!thread.data?.communityThread) {
      return;
    }

    setFavoriteActive(thread.data.communityThread.viewerHasFavorited);
    setAuthorSubscribed(thread.data.communityThread.viewerFollowsAuthor);
    setSeriesSubscribed(thread.data.communityThread.viewerFollowsSeries);
  }, [thread.data]);

  const allTitles = [...(catalog.data?.catalog.featured ?? []), ...(catalog.data?.catalog.bestSellers ?? [])];
  const activeTitle = allTitles.find((title) => title.id === titleId) ?? null;
  const threadData = thread.data?.communityThread;
  const comments = threadData?.comments ?? [];
  const isCatalogEmpty = allTitles.length === 0;

  const submitComment = async () => {
    if (!titleId) {
      addToast('Choose a title before posting.');
      return;
    }

    if (!commentBody.trim()) {
      addToast('Write a comment or question before posting.');
      return;
    }

    await runAction(
      'community-comment',
      async () => {
        await apiRequest(
          '/community/comments',
          {
            method: 'POST',
            body: JSON.stringify({
              titleId,
              parentCommentId: replyTarget?.id,
              commentType,
              body: commentBody.trim(),
            }),
          },
          session,
        );
        setCommentBody('');
        setReplyTarget(null);
        setCommentType('COMMENT');
        await thread.refetch();
        return true;
      },
      {
        successMessage: 'Comment submitted to the local moderation-aware thread.',
        errorMessage: (error) =>
          error instanceof Error ? error.message : 'Comment submission failed.',
      },
    );
  };

  const submitRating = async () => {
    if (!titleId) {
      addToast('Choose a title before rating.');
      return;
    }

    await runAction(
      'community-rating',
      async () => {
        await apiRequest(
          '/community/ratings',
          {
            method: 'POST',
            body: JSON.stringify({ titleId, rating }),
          },
          session,
        );
        await thread.refetch();
        return true;
      },
      {
        successMessage: 'Rating recorded locally.',
        errorMessage: (error) => (error instanceof Error ? error.message : 'Rating could not be saved.'),
      },
    );
  };

  const submitReport = async () => {
    if (!reportTarget) {
      return;
    }

    if (!reportNotes.trim()) {
      addToast('Add a short note before sending the report.');
      return;
    }

    await runAction(
      'community-report',
      async () => {
        await apiRequest(
          '/community/reports',
          {
            method: 'POST',
            body: JSON.stringify({
              commentId: reportTarget.id,
              category: reportCategory,
              notes: reportNotes.trim(),
            }),
          },
          session,
        );
        setReportTarget(null);
        setReportNotes('');
        return true;
      },
      {
        successMessage: 'Report added to the local moderation queue.',
        errorMessage: (error) =>
          error instanceof Error ? error.message : 'Report submission failed.',
      },
    );
  };

  const updateRelationship = async (type: 'mute' | 'block', targetUserId: string, authorName: string) => {
    await runAction(
      `community-${type}-${targetUserId}`,
      async () => {
        await apiRequest(
          type === 'mute' ? '/community/relationships/mute' : '/community/relationships/block',
          {
            method: 'POST',
            body: JSON.stringify({
              targetUserId,
              active: true,
            }),
          },
          session,
        );
        await thread.refetch();
        return true;
      },
      {
        successMessage: `${type === 'mute' ? 'Muted' : 'Blocked'} ${authorName}.`,
        errorMessage: (error) =>
          error instanceof Error ? error.message : `Could not ${type} ${authorName}.`,
      },
    );
  };

  const toggleFavorite = async () => {
    if (!titleId) {
      addToast('Choose a title before favoriting it.');
      return;
    }

    const nextActive = !favoriteActive;
    await runAction(
      'community-favorite',
      async () => {
        await apiRequest(
          '/community/favorites',
          {
            method: 'POST',
            body: JSON.stringify({
              titleId,
              active: nextActive,
            }),
          },
          session,
        );
        setFavoriteActive(nextActive);
        return nextActive;
      },
      {
        successMessage: (active) => (active ? 'Title added to favorites.' : 'Title removed from favorites.'),
        errorMessage: (error) => (error instanceof Error ? error.message : 'Favorite update failed.'),
      },
    );
  };

  const toggleAuthorSubscription = async () => {
    if (!activeTitle) {
      addToast('Choose a title before following its author.');
      return;
    }

    const nextActive = !authorSubscribed;
    await runAction(
      `community-author-${activeTitle.authorId}`,
      async () => {
        await apiRequest(
          '/community/subscriptions/authors',
          {
            method: 'POST',
            body: JSON.stringify({
              targetId: activeTitle.authorId,
              active: nextActive,
            }),
          },
          session,
        );
        setAuthorSubscribed(nextActive);
        return nextActive;
      },
      {
        successMessage: (active) =>
          active ? `Following ${activeTitle.authorName}.` : `Stopped following ${activeTitle.authorName}.`,
        errorMessage: (error) =>
          error instanceof Error ? error.message : 'Author follow state could not be updated.',
      },
    );
  };

  const toggleSeriesSubscription = async () => {
    if (!activeTitle?.seriesId) {
      addToast('This title is not currently assigned to a series.');
      return;
    }

    const nextActive = !seriesSubscribed;
    await runAction(
      `community-series-${activeTitle.seriesId}`,
      async () => {
        await apiRequest(
          '/community/subscriptions/series',
          {
            method: 'POST',
            body: JSON.stringify({
              targetId: activeTitle.seriesId,
              active: nextActive,
            }),
          },
          session,
        );
        setSeriesSubscribed(nextActive);
        return nextActive;
      },
      {
        successMessage: (active) =>
          active ? `Following ${activeTitle.seriesName}.` : `Stopped following ${activeTitle.seriesName}.`,
        errorMessage: (error) =>
          error instanceof Error ? error.message : 'Series follow state could not be updated.',
      },
    );
  };

  const startReply = (target: CommunityComment) => {
    setReplyTarget(target);
    setCommentType('COMMENT');
  };

  const clearReply = () => {
    setReplyTarget(null);
  };

  const startReport = (target: CommunityComment) => {
    setReportTarget(target);
    setReportCategory('ABUSE');
    setReportNotes('');
  };

  const cancelReport = () => {
    setReportTarget(null);
  };

  return {
    catalog,
    thread,
    titleId,
    setTitleId,
    allTitles,
    activeTitle,
    comments,
    isCatalogEmpty,
    commentBody,
    setCommentBody,
    commentType,
    setCommentType,
    rating,
    setRating,
    favoriteActive,
    authorSubscribed,
    seriesSubscribed,
    replyTarget,
    reportTarget,
    reportCategory,
    setReportCategory,
    reportNotes,
    setReportNotes,
    isPending,
    submitComment,
    submitRating,
    submitReport,
    updateRelationship,
    toggleFavorite,
    toggleAuthorSubscription,
    toggleSeriesSubscription,
    startReply,
    clearReply,
    startReport,
    cancelReport,
  };
}
