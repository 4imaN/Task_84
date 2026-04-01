import { ConflictException } from '@nestjs/common';
import { ProfilesService } from './profiles.service';

const queryResult = <T>(rows: T[]) => ({ rows });

describe('ProfilesService', () => {
  const databaseService = {
    query: jest.fn(),
  };
  const auditService = {
    write: jest.fn(),
  };
  const securityService = {
    decryptAtRest: jest.fn(() => 'reader.ada'),
  };

  let service: ProfilesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProfilesService(databaseService as never, auditService as never, securityService as never);
  });

  it('rejects strict sync when the server already has a newer profile', async () => {
    databaseService.query.mockResolvedValueOnce(
      queryResult([
        {
          user_id: 'user-1',
          username: null,
          username_cipher: 'cipher-reader',
          device_label: 'Tablet',
          preferences: { updatedAt: '2026-03-28T12:00:00.000Z' },
          updated_at: '2026-03-28T12:00:00.000Z',
        },
      ]),
    );

    await expect(
      service.syncMine(
        {
          id: 'user-1',
          username: 'reader.ada',
          role: 'CUSTOMER',
          workspace: 'app',
        },
        'trace-1',
        {
          deviceLabel: 'Old Device',
          strict: true,
          preferences: {
            fontFamily: 'Merriweather',
            fontSize: 18,
            lineSpacing: 1.5,
            readerMode: 'PAGINATION',
            theme: 'paper',
            nightMode: false,
            chineseMode: 'SIMPLIFIED',
            updatedAt: '2026-03-28T11:00:00.000Z',
          },
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('persists updates and audits the change for the current user', async () => {
    databaseService.query
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([{ user_id: 'user-1' }]))
      .mockResolvedValueOnce(
        queryResult([
          {
            user_id: 'user-1',
            username: null,
            username_cipher: 'cipher-reader',
            device_label: 'Reviewer Tablet',
            preferences: { fontSize: 22, updatedAt: '2026-03-28T12:30:00.000Z' },
            updated_at: '2026-03-28T12:30:00.000Z',
          },
        ]),
      );

    const result = await service.updateMine(
      {
        id: 'user-1',
        username: 'reader.ada',
        role: 'CUSTOMER',
        workspace: 'app',
      },
      'trace-2',
      {
        deviceLabel: 'Reviewer Tablet',
        preferences: {
          fontFamily: 'Merriweather',
          fontSize: 22,
          lineSpacing: 1.6,
          readerMode: 'SCROLL',
          theme: 'linen',
          nightMode: true,
          chineseMode: 'TRADITIONAL',
          updatedAt: '2026-03-28T12:30:00.000Z',
        },
      },
    );

    expect(result.deviceLabel).toBe('Reviewer Tablet');
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'READING_PROFILE_UPDATED',
        entityType: 'reading_profile',
        entityId: 'user-1',
      }),
    );
  });

  it('rejects stale updates when the server profile is newer', async () => {
    databaseService.query.mockResolvedValueOnce(
      queryResult([
        {
          user_id: 'user-1',
          username: null,
          username_cipher: 'cipher-reader',
          device_label: 'Server Tablet',
          preferences: { fontSize: 22, updatedAt: '2026-03-29T02:00:00.000Z' },
          updated_at: '2026-03-29T02:00:00.000Z',
        },
      ]),
    );

    await expect(
      service.updateMine(
        {
          id: 'user-1',
          username: 'reader.ada',
          role: 'CUSTOMER',
          workspace: 'app',
        },
        'trace-3',
        {
          deviceLabel: 'Imported Tablet',
          preferences: {
            fontFamily: 'Merriweather',
            fontSize: 20,
            lineSpacing: 1.5,
            readerMode: 'PAGINATION',
            theme: 'paper',
            nightMode: false,
            chineseMode: 'SIMPLIFIED',
            updatedAt: '2026-03-29T01:00:00.000Z',
          },
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
