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
});
