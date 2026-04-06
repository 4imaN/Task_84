import { BadRequestException, ConflictException } from '@nestjs/common';
import { CommunityService } from './community.service';

describe('CommunityService', () => {
  const databaseService = {
    query: jest.fn(),
    withTransaction: jest.fn(),
  };
  const auditService = {
    write: jest.fn(),
  };

  const user = {
    id: 'reader-1',
    username: 'reader.ada',
    role: 'CUSTOMER',
    workspace: 'app',
  } as const;

  let service: CommunityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CommunityService(databaseService as never, auditService as never);
    auditService.write.mockResolvedValue(undefined);
  });

  it('creates a comment and writes the moderation-safe audit payload', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'title-1' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'comment-1', created_at: '2026-03-29T12:00:00.000Z' }] }),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );

    const created = await service.createComment(user, 'trace-1', {
      titleId: 'title-1',
      commentType: 'COMMENT',
      body: 'A thoughtful local reader note.',
    });

    expect(created).toEqual({
      id: 'comment-1',
      createdAt: '2026-03-29T12:00:00.000Z',
    });
    expect(auditService.write).toHaveBeenCalledWith({
      traceId: 'trace-1',
      actorUserId: 'reader-1',
      action: 'COMMENT_CREATED',
      entityType: 'comment',
      entityId: 'comment-1',
      payload: {
        titleId: 'title-1',
        parentCommentId: null,
        commentType: 'COMMENT',
      },
    }, transactionClient);
  });

  it('creates a reply when the parent comment belongs to the same title', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'title-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'parent-1', title_id: 'title-1' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'reply-1', created_at: '2026-03-29T12:05:00.000Z' }] }),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );

    const created = await service.createComment(user, 'trace-reply', {
      titleId: 'title-1',
      parentCommentId: 'parent-1',
      commentType: 'QUESTION',
      body: 'Does this edition include the map insert?',
    });

    expect(created).toEqual({
      id: 'reply-1',
      createdAt: '2026-03-29T12:05:00.000Z',
    });
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'COMMENT_CREATED',
        payload: expect.objectContaining({
          titleId: 'title-1',
          parentCommentId: 'parent-1',
          commentType: 'QUESTION',
        }),
      }),
      transactionClient,
    );
  });

  it('rejects replies whose parent comment belongs to another title', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'title-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'parent-2', title_id: 'title-2' }] }),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );

    await expect(
      service.createComment(user, 'trace-cross-title', {
        titleId: 'title-1',
        parentCommentId: 'parent-2',
        commentType: 'QUESTION',
        body: 'This should not thread across titles.',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(auditService.write).not.toHaveBeenCalled();
  });

  it('rejects comments that contain a sensitive term', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'title-1' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ word: 'spoiler' }] }),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );

    await expect(
      service.createComment(user, 'trace-2', {
        titleId: 'title-1',
        commentType: 'COMMENT',
        body: 'This spoiler should be rejected.',
      }),
    ).rejects.toMatchObject({
      message: 'The comment contains prohibited content.',
    });
    expect(auditService.write).not.toHaveBeenCalled();
  });

  it('rejects duplicate comment content within the 60-second window', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'title-1' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'duplicate-comment' }] }),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );

    await expect(
      service.createComment(user, 'trace-3', {
        titleId: 'title-1',
        commentType: 'COMMENT',
        body: 'Repeated local note',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates reports and audits the governance action', async () => {
    databaseService.query
      .mockResolvedValueOnce({ rows: [{ id: 'comment-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'report-1' }] });

    const created = await service.createReport(user, 'trace-4', {
      commentId: 'comment-1',
      category: 'ABUSE',
      notes: 'Escalating this for moderation review.',
    });

    expect(created).toEqual({ reportId: 'report-1' });
    expect(auditService.write).toHaveBeenCalledWith({
      traceId: 'trace-4',
      actorUserId: 'reader-1',
      action: 'REPORT_CREATED',
      entityType: 'report',
      entityId: 'report-1',
      payload: {
        commentId: 'comment-1',
        category: 'ABUSE',
      },
    });
  });

  it('rejects self-target mute relationships', async () => {
    await expect(
      service.updateMute(user, 'trace-self-mute', {
        targetUserId: user.id,
        active: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(databaseService.query).not.toHaveBeenCalled();
    expect(auditService.write).not.toHaveBeenCalled();
  });

  it('rejects self-target block relationships', async () => {
    await expect(
      service.updateBlock(user, 'trace-self-block', {
        targetUserId: user.id,
        active: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(databaseService.query).not.toHaveBeenCalled();
    expect(auditService.write).not.toHaveBeenCalled();
  });
});
