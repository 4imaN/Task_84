import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';

const queryResult = <T>(rows: T[]) => ({ rows });

describe('CatalogService', () => {
  const databaseService = {
    query: jest.fn(),
  };

  let service: CatalogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CatalogService(databaseService as never);
  });

  it('derives featured and best-seller slices from one shared catalog query', async () => {
    databaseService.query.mockResolvedValueOnce(
      queryResult([
        {
          id: 'title-1',
          slug: 'title-1',
          name: 'Title 1',
          format: 'DIGITAL',
          price_cents: 1099,
          inventory_on_hand: 10,
          author_id: 'author-1',
          author_name: 'Author 1',
          series_id: null,
          series_name: null,
          chapter_count: '8',
        },
        {
          id: 'title-2',
          slug: 'title-2',
          name: 'Title 2',
          format: 'DIGITAL',
          price_cents: 1299,
          inventory_on_hand: 8,
          author_id: 'author-2',
          author_name: 'Author 2',
          series_id: null,
          series_name: null,
          chapter_count: '6',
        },
        {
          id: 'title-physical',
          slug: 'title-physical',
          name: 'Physical title',
          format: 'PHYSICAL',
          price_cents: 2499,
          inventory_on_hand: 12,
          author_id: 'author-3',
          author_name: 'Author 3',
          series_id: null,
          series_name: null,
          chapter_count: '0',
        },
        {
          id: 'title-bundle',
          slug: 'title-bundle',
          name: 'Bundle title',
          format: 'BUNDLE',
          price_cents: 3299,
          inventory_on_hand: 6,
          author_id: 'author-4',
          author_name: 'Author 4',
          series_id: null,
          series_name: null,
          chapter_count: '0',
        },
        {
          id: 'title-3',
          slug: 'title-3',
          name: 'Title 3',
          format: 'DIGITAL',
          price_cents: 1599,
          inventory_on_hand: 6,
          author_id: 'author-4',
          author_name: 'Author 4',
          series_id: null,
          series_name: null,
          chapter_count: '7',
        },
        {
          id: 'title-4',
          slug: 'title-4',
          name: 'Title 4',
          format: 'DIGITAL',
          price_cents: 1799,
          inventory_on_hand: 5,
          author_id: 'author-5',
          author_name: 'Author 5',
          series_id: null,
          series_name: null,
          chapter_count: '9',
        },
        {
          id: 'title-5',
          slug: 'title-5',
          name: 'Title 5',
          format: 'DIGITAL',
          price_cents: 1899,
          inventory_on_hand: 4,
          author_id: 'author-6',
          author_name: 'Author 6',
          series_id: null,
          series_name: null,
          chapter_count: '5',
        },
        {
          id: 'title-6',
          slug: 'title-6',
          name: 'Title 6',
          format: 'DIGITAL',
          price_cents: 1999,
          inventory_on_hand: 3,
          author_id: 'author-7',
          author_name: 'Author 7',
          series_id: null,
          series_name: null,
          chapter_count: '10',
        },
      ]),
    );

    const catalog = await service.getCatalog();

    expect(databaseService.query).toHaveBeenCalledTimes(1);
    expect(catalog.featured.map((entry) => entry.id)).toEqual([
      'title-1',
      'title-2',
      'title-physical',
      'title-bundle',
    ]);
    expect(catalog.featured.find((entry) => entry.id === 'title-physical')?.isReadable).toBe(false);
    expect(catalog.featured.find((entry) => entry.id === 'title-bundle')?.isReadable).toBe(false);
    expect(catalog.bestSellers.map((entry) => entry.id)).toEqual([
      'title-1',
      'title-2',
      'title-physical',
      'title-bundle',
      'title-3',
      'title-4',
    ]);
    expect(catalog.bestSellers.find((entry) => entry.id === 'title-physical')?.format).toBe('PHYSICAL');
    expect(catalog.bestSellers.find((entry) => entry.id === 'title-bundle')?.format).toBe('BUNDLE');
  });

  it('masks blocked or muted comment bodies for the viewer', async () => {
    databaseService.query
      .mockResolvedValueOnce(
        queryResult([
          {
            viewer_has_favorited: false,
            viewer_follows_author: false,
            viewer_follows_series: false,
          },
        ]),
      )
      .mockResolvedValueOnce(
        queryResult([
          {
            id: 'comment-1',
            parent_comment_id: null,
            comment_type: 'COMMENT',
            body: 'Visible only when no viewer policy blocks it.',
            is_hidden: false,
            created_at: '2026-03-28T12:00:00.000Z',
            author_name: 'Mei Reader',
            author_id: 'user-2',
            viewer_has_blocked: true,
            author_has_blocked_viewer: false,
            viewer_has_muted: false,
          },
        ]),
      )
      .mockResolvedValueOnce(queryResult([{ average_rating: '4.50', total_ratings: '2' }]));

    const thread = await service.getCommunityThread(
      {
        id: 'user-1',
        username: 'reader.ada',
        role: 'CUSTOMER',
        workspace: 'app',
      },
      'title-1',
    );

    expect(thread.comments[0]?.visibleBody).toBe('[masked for viewer policy]');
    expect(thread.totalRatings).toBe(2);
  });

  it('returns not-found semantics when the thread title does not exist', async () => {
    databaseService.query.mockResolvedValueOnce(queryResult([]));

    await expect(
      service.getCommunityThread(
        {
          id: 'user-1',
          username: 'reader.ada',
          role: 'CUSTOMER',
          workspace: 'app',
        },
        'missing-title-id',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('attaches a reply even when the reply row is returned before its parent row', async () => {
    databaseService.query
      .mockResolvedValueOnce(
        queryResult([
          {
            viewer_has_favorited: false,
            viewer_follows_author: false,
            viewer_follows_series: false,
          },
        ]),
      )
      .mockResolvedValueOnce(
        queryResult([
          {
            id: 'a-reply',
            parent_comment_id: 'z-parent',
            comment_type: 'QUESTION',
            body: 'Child row arrives first in this result set.',
            is_hidden: false,
            created_at: '2026-03-28T12:00:00.000Z',
            author_name: 'Ada Reader',
            author_id: 'user-2',
            viewer_has_blocked: false,
            author_has_blocked_viewer: false,
            viewer_has_muted: false,
          },
          {
            id: 'z-parent',
            parent_comment_id: null,
            comment_type: 'COMMENT',
            body: 'Parent row arrives second.',
            is_hidden: false,
            created_at: '2026-03-28T12:00:00.000Z',
            author_name: 'Mei Reader',
            author_id: 'user-3',
            viewer_has_blocked: false,
            author_has_blocked_viewer: false,
            viewer_has_muted: false,
          },
        ]),
      )
      .mockResolvedValueOnce(queryResult([{ average_rating: '4.50', total_ratings: '2' }]));

    const thread = await service.getCommunityThread(
      {
        id: 'user-1',
        username: 'reader.ada',
        role: 'CUSTOMER',
        workspace: 'app',
      },
      'title-1',
    );

    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0]?.id).toBe('z-parent');
    expect(thread.comments[0]?.replies).toHaveLength(1);
    expect(thread.comments[0]?.replies[0]?.id).toBe('a-reply');
  });

  it('assembles nested replies correctly even when rows are returned child-first', async () => {
    databaseService.query
      .mockResolvedValueOnce(
        queryResult([
          {
            viewer_has_favorited: false,
            viewer_follows_author: false,
            viewer_follows_series: false,
          },
        ]),
      )
      .mockResolvedValueOnce(
        queryResult([
          {
            id: 'a-grandchild',
            parent_comment_id: 'b-child',
            comment_type: 'COMMENT',
            body: 'Nested reply row.',
            is_hidden: false,
            created_at: '2026-03-28T12:00:00.000Z',
            author_name: 'Nested User',
            author_id: 'user-5',
            viewer_has_blocked: false,
            author_has_blocked_viewer: false,
            viewer_has_muted: false,
          },
          {
            id: 'b-child',
            parent_comment_id: 'c-root',
            comment_type: 'QUESTION',
            body: 'Intermediate reply row.',
            is_hidden: false,
            created_at: '2026-03-28T12:00:00.000Z',
            author_name: 'Intermediate User',
            author_id: 'user-4',
            viewer_has_blocked: false,
            author_has_blocked_viewer: false,
            viewer_has_muted: false,
          },
          {
            id: 'c-root',
            parent_comment_id: null,
            comment_type: 'COMMENT',
            body: 'Root row.',
            is_hidden: false,
            created_at: '2026-03-28T12:00:00.000Z',
            author_name: 'Root User',
            author_id: 'user-3',
            viewer_has_blocked: false,
            author_has_blocked_viewer: false,
            viewer_has_muted: false,
          },
        ]),
      )
      .mockResolvedValueOnce(queryResult([{ average_rating: '4.00', total_ratings: '3' }]));

    const thread = await service.getCommunityThread(
      {
        id: 'user-1',
        username: 'reader.ada',
        role: 'CUSTOMER',
        workspace: 'app',
      },
      'title-1',
    );

    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0]?.id).toBe('c-root');
    expect(thread.comments[0]?.replies).toHaveLength(1);
    expect(thread.comments[0]?.replies[0]?.id).toBe('b-child');
    expect(thread.comments[0]?.replies[0]?.replies).toHaveLength(1);
    expect(thread.comments[0]?.replies[0]?.replies[0]?.id).toBe('a-grandchild');
  });
});
