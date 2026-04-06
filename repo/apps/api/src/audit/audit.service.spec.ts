import { AuditService } from './audit.service';

describe('AuditService', () => {
  const databaseService = {
    query: jest.fn(),
    withTransaction: jest.fn(),
  };
  const securityService = {
    hashChain: jest.fn((payload: unknown, previousHash: string | null) =>
      JSON.stringify({ previousHash, payload }),
    ),
    signChain: jest.fn(
      (
        recordType: string,
        payload: unknown,
        previousHash: string | null,
        currentHash: string,
      ) => JSON.stringify({ recordType, previousHash, currentHash, payload }),
    ),
  };

  let service: AuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditService(databaseService as never, securityService as never);
  });

  it('uses a deterministic latest-row lookup order when appending to the audit chain', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ current_hash: 'previous-hash' }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );

    await service.write({
      traceId: 'trace-audit-order',
      actorUserId: 'user-1',
      action: 'AUDIT_TEST',
      entityType: 'audit',
      entityId: 'row-1',
      payload: { ok: true },
    });

    expect(transactionClient.query).toHaveBeenNthCalledWith(
      2,
      'SELECT current_hash FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 1',
    );
  });

  it('verifies legitimate same-timestamp audit rows without false positives', async () => {
    const createdAt = '2026-04-05T00:00:00.000Z';
    const payloadA = {
      traceId: 'trace-a',
      actorUserId: 'moderator-1',
      action: 'MODERATION_ACTION_APPLIED',
      entityType: 'moderation_action',
      entityId: 'action-1',
      payload: { reportId: 'report-1' },
      createdAt,
    };
    const currentHashA = securityService.hashChain(payloadA, null);
    const signatureA = securityService.signChain('audit', payloadA, null, currentHashA);
    const payloadB = {
      traceId: 'trace-b',
      actorUserId: 'moderator-1',
      action: 'MODERATION_ACTION_APPLIED',
      entityType: 'moderation_action',
      entityId: 'action-2',
      payload: { reportId: 'report-2' },
      createdAt,
    };
    const currentHashB = securityService.hashChain(payloadB, currentHashA);
    const signatureB = securityService.signChain('audit', payloadB, currentHashA, currentHashB);

    databaseService.query.mockResolvedValueOnce({
      rows: [
        {
          id: '00000000-0000-4000-8000-000000000010',
          trace_id: payloadA.traceId,
          actor_user_id: payloadA.actorUserId,
          action: payloadA.action,
          entity_type: payloadA.entityType,
          entity_id: payloadA.entityId,
          payload: payloadA.payload,
          previous_hash: null,
          current_hash: currentHashA,
          chain_signature: signatureA,
          created_at: createdAt,
        },
        {
          id: '00000000-0000-4000-8000-000000000020',
          trace_id: payloadB.traceId,
          actor_user_id: payloadB.actorUserId,
          action: payloadB.action,
          entity_type: payloadB.entityType,
          entity_id: payloadB.entityId,
          payload: payloadB.payload,
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

  it('detects payload rewrites even when an attacker recomputes plain hashes without the signing key', async () => {
    const createdAt = '2026-04-05T00:00:00.000Z';
    const originalPayload = {
      traceId: 'trace-orig',
      actorUserId: 'moderator-1',
      action: 'MODERATION_ACTION_APPLIED',
      entityType: 'moderation_action',
      entityId: 'action-1',
      payload: { reportId: 'report-1', status: 'OPEN' },
      createdAt,
    };
    const originalHash = securityService.hashChain(originalPayload, null);
    const originalSignature = securityService.signChain('audit', originalPayload, null, originalHash);

    const tamperedPayload = {
      ...originalPayload,
      payload: { reportId: 'report-1', status: 'RESOLVED' },
    };
    const recomputedHash = securityService.hashChain(tamperedPayload, null);

    databaseService.query.mockResolvedValueOnce({
      rows: [
        {
          id: '00000000-0000-4000-8000-000000000010',
          trace_id: tamperedPayload.traceId,
          actor_user_id: tamperedPayload.actorUserId,
          action: tamperedPayload.action,
          entity_type: tamperedPayload.entityType,
          entity_id: tamperedPayload.entityId,
          payload: tamperedPayload.payload,
          previous_hash: null,
          current_hash: recomputedHash,
          chain_signature: originalSignature,
          created_at: createdAt,
        },
      ],
    });

    const result = await service.verifyIntegrity();

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((issue) =>
        issue.reason.includes('chain_signature does not match the stored audit payload.'),
      ),
    ).toBe(true);
  });
});
