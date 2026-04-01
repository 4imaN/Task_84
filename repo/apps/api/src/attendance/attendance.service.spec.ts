import { BadRequestException } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { AttendanceService } from './attendance.service';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
}));

const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x01, 0xe5, 0x27, 0xd4, 0xa2, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

describe('AttendanceService', () => {
  const configService = {
    get: jest.fn(() => '/tmp/ledgerread-evidence-test'),
  };
  const databaseService = {
    query: jest.fn(),
    withTransaction: jest.fn(),
  };
  const securityService = {
    checksum: jest.fn(() => 'checksum-value'),
    hashChain: jest.fn(() => 'current-hash'),
  };
  const auditService = {
    write: jest.fn(),
  };

  let service: AttendanceService;
  let warnSpy: jest.Mock;
  let logSpy: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (mkdir as jest.Mock).mockResolvedValue(undefined);
    (writeFile as jest.Mock).mockResolvedValue(undefined);
    service = new AttendanceService(
      configService as never,
      databaseService as never,
      securityService as never,
      auditService as never,
    );
    warnSpy = jest.fn();
    logSpy = jest.fn();
    (service as any).logger = {
      warn: warnSpy,
      log: logSpy,
    };
  });

  it('requires an evidence file when expectedChecksum is provided', async () => {
    await expect(
      service.clockIn(
        {
          id: 'clerk-1',
          username: 'clerk.emma',
          role: 'CLERK',
          workspace: 'pos',
        },
        'trace-1',
        {
          occurredAt: '2026-03-28T12:00:00.000Z',
          expectedChecksum: 'missing-file',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unsupported evidence mime types before persisting', async () => {
    await expect(
      service.clockIn(
        {
          id: 'clerk-1',
          username: 'clerk.emma',
          role: 'CLERK',
          workspace: 'pos',
        },
        'trace-2',
        {
          occurredAt: '2026-03-28T12:00:00.000Z',
        },
        {
          buffer: Buffer.from('plain-text'),
          mimetype: 'text/plain',
          originalname: 'bad.txt',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(databaseService.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects files whose bytes do not match a supported image signature', async () => {
    await expect(
      service.clockIn(
        {
          id: 'clerk-1',
          username: 'clerk.emma',
          role: 'CLERK',
          workspace: 'pos',
        },
        'trace-3',
        {
          occurredAt: '2026-03-28T12:00:00.000Z',
        },
        {
          buffer: Buffer.from('not-really-a-png'),
          mimetype: 'image/png',
          originalname: 'forged.png',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writeFile).not.toHaveBeenCalled();
    const emitted = warnSpy.mock.calls.flat().join(' ');
    expect(emitted).toContain('ATTENDANCE_EVIDENCE_REJECTED');
    expect(emitted).toContain('traceId=trace-3');
    expect(emitted).not.toContain('forged.png');
  });

  it('stores valid evidence under a server-generated safe filename', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'attendance-1' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (queryable: typeof client) => Promise<unknown>) => runner(client),
    );
    databaseService.query.mockResolvedValue({ rows: [] });
    auditService.write.mockResolvedValue(undefined);

    await service.clockIn(
      {
        id: 'clerk-1',
        username: 'clerk.emma',
        role: 'CLERK',
        workspace: 'pos',
      },
      'trace-4',
      {
        occurredAt: '2026-03-28T12:00:00.000Z',
      },
      {
        buffer: VALID_PNG,
        mimetype: 'image/png',
        originalname: '../../../evil.png',
      },
    );

    expect(writeFile).toHaveBeenCalledTimes(1);
    const persistedPath = (writeFile as jest.Mock).mock.calls[0]?.[0] as string;
    expect(persistedPath.startsWith('/tmp/ledgerread-evidence-test/')).toBe(true);
    expect(persistedPath.includes('..')).toBe(false);
    expect(persistedPath.endsWith('.png')).toBe(true);
    const emitted = logSpy.mock.calls.flat().join(' ');
    expect(emitted).toContain('ATTENDANCE_RECORDED');
    expect(emitted).toContain('userId=clerk-1');
    expect(emitted).toContain('traceId=trace-4');
    expect(emitted).not.toContain('clerk.emma');
  });

  it('creates overdue clock-out alerts during the scheduled evaluation without user interaction', async () => {
    databaseService.query
      .mockResolvedValueOnce({ rows: [{ id: 'rule-1' }] })
      .mockResolvedValueOnce({ rowCount: 2, rows: [] });

    const created = await service.evaluateOverdueClockOuts();

    expect(created).toBe(2);
    expect(databaseService.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO risk_alerts'),
      ['rule-1', null],
    );
  });
});
