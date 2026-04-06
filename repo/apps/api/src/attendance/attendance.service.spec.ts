import { BadRequestException } from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { AttendanceService } from './attendance.service';

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(),
  unlink: jest.fn(),
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
    get: jest.fn((key: string) =>
      key === 'attendanceClientClockSkewSeconds'
        ? 10 * 365 * 24 * 60 * 60
        : '/tmp/ledgerread-evidence-test',
    ),
  };
  const databaseService = {
    query: jest.fn(),
    withTransaction: jest.fn(),
  };
  const securityService = {
    checksum: jest.fn(() => 'checksum-value'),
    hashChain: jest.fn(() => 'current-hash'),
    signChain: jest.fn(
      (
        recordType: string,
        payload: unknown,
        previousHash: string | null,
        currentHash: string,
      ) => JSON.stringify({ recordType, previousHash, currentHash, payload }),
    ),
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
    (unlink as jest.Mock).mockResolvedValue(undefined);
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

  it('requires expectedChecksum whenever evidence is attached', async () => {
    await expect(
      service.clockIn(
        {
          id: 'clerk-1',
          username: 'clerk.emma',
          role: 'CLERK',
          workspace: 'pos',
        },
        'trace-required-checksum',
        {
          occurredAt: '2026-03-28T12:00:00.000Z',
        },
        {
          buffer: VALID_PNG,
          mimetype: 'image/png',
          originalname: 'proof.png',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(databaseService.withTransaction).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
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
          expectedChecksum: 'checksum-value',
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
          expectedChecksum: 'checksum-value',
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
        expectedChecksum: 'checksum-value',
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
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      'SELECT current_hash FROM attendance_records ORDER BY created_at DESC, id DESC LIMIT 1',
    );
    expect(unlink).not.toHaveBeenCalled();
    const emitted = logSpy.mock.calls.flat().join(' ');
    expect(emitted).toContain('ATTENDANCE_RECORDED');
    expect(emitted).toContain('userId=clerk-1');
    expect(emitted).toContain('traceId=trace-4');
    expect(emitted).not.toContain('clerk.emma');
  });

  it('cleans up persisted evidence files when the attendance transaction fails', async () => {
    databaseService.withTransaction.mockRejectedValue(new Error('transaction-failed'));

    await expect(
      service.clockIn(
        {
          id: 'clerk-1',
          username: 'clerk.emma',
          role: 'CLERK',
          workspace: 'pos',
        },
        'trace-tx-failure',
        {
          occurredAt: '2026-03-28T12:00:00.000Z',
          expectedChecksum: 'checksum-value',
        },
        {
          buffer: VALID_PNG,
          mimetype: 'image/png',
          originalname: 'proof.png',
        },
      ),
    ).rejects.toThrow('transaction-failed');

    expect(writeFile).toHaveBeenCalledTimes(1);
    const persistedPath = (writeFile as jest.Mock).mock.calls[0]?.[0] as string;
    expect(unlink).toHaveBeenCalledWith(persistedPath);
  });

  it('rejects mismatched evidence checksums while still creating a risk alert', async () => {
    databaseService.query
      .mockResolvedValueOnce({ rows: [{ id: 'rule-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      service.clockIn(
        {
          id: 'clerk-1',
          username: 'clerk.emma',
          role: 'CLERK',
          workspace: 'pos',
        },
        'trace-checksum-mismatch',
        {
          occurredAt: '2026-03-28T12:00:00.000Z',
          expectedChecksum: 'different-checksum',
        },
        {
          buffer: VALID_PNG,
          mimetype: 'image/png',
          originalname: 'proof.png',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(databaseService.withTransaction).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(databaseService.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO risk_alerts'),
      [null, 'rule-1', 'Evidence file checksum mismatch.', 'clerk-1'],
    );
    const emitted = warnSpy.mock.calls.flat().join(' ');
    expect(emitted).toContain('ATTENDANCE_CHECKSUM_MISMATCH');
    expect(emitted).toContain('traceId=trace-checksum-mismatch');
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

  it('keeps overdue refresh self-scoped for clerk attendance risk views', async () => {
    const evaluateSpy = jest.spyOn(service, 'evaluateOverdueClockOuts').mockResolvedValue(0);
    databaseService.query.mockResolvedValueOnce({ rows: [] });

    await service.getRiskAlerts({
      id: 'clerk-1',
      username: 'clerk.emma',
      role: 'CLERK',
      workspace: 'pos',
    });

    expect(evaluateSpy).toHaveBeenCalledWith('clerk-1');
    expect(databaseService.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE ($1::boolean = FALSE OR COALESCE(attendance_records.user_id, risk_alerts.user_id) = $2)'),
      [true, 'clerk-1'],
    );
  });

  it('runs global overdue refresh for manager attendance risk views', async () => {
    const evaluateSpy = jest.spyOn(service, 'evaluateOverdueClockOuts').mockResolvedValue(0);
    databaseService.query.mockResolvedValueOnce({ rows: [] });

    await service.getRiskAlerts({
      id: 'manager-1',
      username: 'manager.li',
      role: 'MANAGER',
      workspace: 'admin',
    });

    expect(evaluateSpy).toHaveBeenCalledWith(undefined);
    expect(databaseService.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE ($1::boolean = FALSE OR COALESCE(attendance_records.user_id, risk_alerts.user_id) = $2)'),
      [false, 'manager-1'],
    );
  });

  it('verifies legitimate same-timestamp attendance rows without false positives', async () => {
    const localHash = (payload: unknown, previousHash: string | null) =>
      JSON.stringify({ previousHash, payload });
    securityService.hashChain.mockImplementation(localHash as unknown as () => string);
    const localSignature = (
      recordType: string,
      payload: unknown,
      previousHash: string | null,
      currentHash: string,
    ) => JSON.stringify({ recordType, previousHash, currentHash, payload });
    securityService.signChain.mockImplementation(localSignature as unknown as () => string);
    const createdAt = '2026-04-05T00:00:00.000Z';
    const eventTime = '2026-04-05T00:00:00.000Z';
    const payloadA = {
      userId: 'clerk-1',
      eventType: 'CLOCK_IN',
      occurredAt: eventTime,
      evidenceChecksum: null,
    };
    const currentHashA = localHash(payloadA, null);
    const signatureA = localSignature('attendance', payloadA, null, currentHashA);
    const payloadB = {
      userId: 'clerk-1',
      eventType: 'CLOCK_OUT',
      occurredAt: eventTime,
      evidenceChecksum: null,
    };
    const currentHashB = localHash(payloadB, currentHashA);
    const signatureB = localSignature('attendance', payloadB, currentHashA, currentHashB);

    databaseService.query.mockResolvedValueOnce({
      rows: [
        {
          id: '00000000-0000-4000-8000-000000000010',
          user_id: payloadA.userId,
          event_type: payloadA.eventType,
          occurred_at: eventTime,
          evidence_checksum: null,
          previous_hash: null,
          current_hash: currentHashA,
          chain_signature: signatureA,
          created_at: createdAt,
        },
        {
          id: '00000000-0000-4000-8000-000000000020',
          user_id: payloadB.userId,
          event_type: payloadB.eventType,
          occurred_at: eventTime,
          evidence_checksum: null,
          previous_hash: currentHashA,
          current_hash: currentHashB,
          chain_signature: signatureB,
          created_at: createdAt,
        },
      ],
    });

    const result = await service.verifyIntegrity();

    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY created_at ASC, id ASC'),
    );
    expect(result).toEqual({
      valid: true,
      checkedEntries: 2,
      issues: [],
    });
  });

  it('detects recomputed attendance hashes when signatures cannot be recomputed', async () => {
    const localHash = (payload: unknown, previousHash: string | null) =>
      JSON.stringify({ previousHash, payload });
    securityService.hashChain.mockImplementation(localHash as unknown as () => string);
    const localSignature = (
      recordType: string,
      payload: unknown,
      previousHash: string | null,
      currentHash: string,
    ) => JSON.stringify({ recordType, previousHash, currentHash, payload });
    securityService.signChain.mockImplementation(localSignature as unknown as () => string);

    const occurredAt = '2026-04-05T00:00:00.000Z';
    const originalPayload = {
      userId: 'clerk-1',
      eventType: 'CLOCK_IN',
      occurredAt,
      evidenceChecksum: null,
    };
    const originalHash = localHash(originalPayload, null);
    const originalSignature = localSignature('attendance', originalPayload, null, originalHash);

    const tamperedPayload = {
      ...originalPayload,
      evidenceChecksum: 'forged-checksum',
    };
    const recomputedHash = localHash(tamperedPayload, null);

    databaseService.query.mockResolvedValueOnce({
      rows: [
        {
          id: '00000000-0000-4000-8000-000000000010',
          user_id: tamperedPayload.userId,
          event_type: tamperedPayload.eventType,
          occurred_at: tamperedPayload.occurredAt,
          evidence_checksum: tamperedPayload.evidenceChecksum,
          previous_hash: null,
          current_hash: recomputedHash,
          chain_signature: originalSignature,
        },
      ],
    });

    const result = await service.verifyIntegrity();

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) =>
        issue.reason.includes('chain_signature does not match the stored attendance payload.'),
      ),
    ).toBe(true);
  });

  it('verifies chains against the authoritative occurred_at plus stored client_occurred_at metadata', async () => {
    const localHash = (payload: unknown, previousHash: string | null) =>
      JSON.stringify({ previousHash, payload });
    securityService.hashChain.mockImplementation(localHash as unknown as () => string);
    const localSignature = (
      recordType: string,
      payload: unknown,
      previousHash: string | null,
      currentHash: string,
    ) => JSON.stringify({ recordType, previousHash, currentHash, payload });
    securityService.signChain.mockImplementation(localSignature as unknown as () => string);

    const authoritativeOccurredAt = '2026-04-06T12:00:00.000Z';
    const clientOccurredAt = '2026-04-06T11:58:00.000Z';
    const payload = {
      userId: 'clerk-1',
      eventType: 'CLOCK_IN',
      occurredAt: authoritativeOccurredAt,
      clientOccurredAt,
      evidenceChecksum: null,
    };
    const currentHash = localHash(payload, null);
    const signature = localSignature('attendance', payload, null, currentHash);

    databaseService.query.mockResolvedValueOnce({
      rows: [
        {
          id: '00000000-0000-4000-8000-000000000010',
          user_id: payload.userId,
          event_type: payload.eventType,
          occurred_at: authoritativeOccurredAt,
          client_occurred_at: clientOccurredAt,
          evidence_checksum: null,
          previous_hash: null,
          current_hash: currentHash,
          chain_signature: signature,
        },
      ],
    });

    const result = await service.verifyIntegrity();

    expect(result).toEqual({
      valid: true,
      checkedEntries: 1,
      issues: [],
    });
  });
});
