import { ModerationService } from './moderation.service';
import { ConflictException } from '@nestjs/common';

const queryResult = <T>(rows: T[]) => ({ rows });

describe('ModerationService', () => {
  const databaseService = {
    query: jest.fn(),
    withTransaction: jest.fn(),
  };
  const auditService = {
    write: jest.fn(),
  };

  let service: ModerationService;
  let logSpy: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ModerationService(databaseService as never, auditService as never);
    logSpy = jest.fn();
    (service as any).logger = {
      log: logSpy,
    };
  });

  it('derives the suspended account from report and comment context', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce(
          queryResult([
            {
              id: 'report-1',
              comment_id: 'comment-1',
              comment_author_id: 'user-2',
            },
          ]),
        )
        .mockResolvedValueOnce(queryResult([{ id: 'comment-1', user_id: 'user-2' }]))
        .mockResolvedValueOnce(queryResult([{ id: 'user-2' }]))
        .mockResolvedValueOnce(queryResult([]))
        .mockResolvedValueOnce(queryResult([{ id: 'action-1' }]))
        .mockResolvedValueOnce(queryResult([])),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );
    auditService.write.mockResolvedValue(undefined);

    await service.applyAction(
      {
        id: 'moderator-1',
        username: 'mod.noah',
        role: 'MODERATOR',
        workspace: 'mod',
      },
      'trace-1',
      {
        reportId: 'report-1',
        targetCommentId: 'comment-1',
        action: 'suspend',
        notes: 'coverage',
      },
    );

    expect(transactionClient.query).toHaveBeenCalledWith(
      'UPDATE users SET is_suspended = TRUE WHERE id = $1',
      ['user-2'],
    );
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          targetUserId: 'user-2',
          targetCommentId: 'comment-1',
          reportId: 'report-1',
          action: 'suspend',
        }),
      }),
      transactionClient,
    );
  });

  it('rejects client-supplied targets that do not match the reported record', async () => {
    const transactionClient = {
      query: jest.fn().mockResolvedValueOnce(
        queryResult([
          {
            id: 'report-1',
            comment_id: 'comment-1',
            comment_author_id: 'user-2',
          },
        ]),
      ),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );

    await expect(
      service.applyAction(
        {
          id: 'moderator-1',
          username: 'mod.noah',
          role: 'MODERATOR',
          workspace: 'mod',
        },
        'trace-2',
        {
          reportId: 'report-1',
          targetCommentId: 'comment-other',
          action: 'hide',
          notes: 'mismatch coverage',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('redacts moderation success logs to ids and trace context only', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce(
          queryResult([
            {
              id: 'report-1',
              comment_id: 'comment-1',
              comment_author_id: 'user-2',
            },
          ]),
        )
        .mockResolvedValueOnce(queryResult([{ id: 'comment-1', user_id: 'user-2' }]))
        .mockResolvedValueOnce(queryResult([{ id: 'user-2' }]))
        .mockResolvedValueOnce(queryResult([]))
        .mockResolvedValueOnce(queryResult([{ id: 'action-1' }]))
        .mockResolvedValueOnce(queryResult([])),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );
    auditService.write.mockResolvedValue(undefined);

    await service.applyAction(
      {
        id: 'moderator-1',
        username: 'mod.noah',
        role: 'MODERATOR',
        workspace: 'mod',
      },
      'trace-redaction-1',
      {
        reportId: 'report-1',
        targetCommentId: 'comment-1',
        action: 'hide',
        notes: 'redaction coverage',
      },
    );

    const emitted = logSpy.mock.calls.flat().join(' ');
    expect(emitted).toContain('MODERATION_ACTION_APPLIED');
    expect(emitted).toContain('traceId=trace-redaction-1');
    expect(emitted).toContain('moderatorUserId=moderator-1');
    expect(emitted).toContain('reportId=report-1');
    expect(emitted).not.toContain('mod.noah');
  });
});
