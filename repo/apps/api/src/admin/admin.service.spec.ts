import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

const queryResult = <T>(rows: T[]) => ({ rows });

describe('AdminService', () => {
  const databaseService = {
    query: jest.fn(),
    withTransaction: jest.fn(),
  };
  const auditService = {
    write: jest.fn(),
  };
  const attendanceService = {
    verifyIntegrity: jest.fn(),
  };
  const securityService = {
    encryptAtRest: jest.fn((value: string) => `cipher:${value}`),
  };

  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminService(
      databaseService as never,
      auditService as never,
      attendanceService as never,
      securityService as never,
    );
  });

  it('allocates landed cost proportionally and preserves the remainder', () => {
    const allocations = (service as any).allocateLandedCosts(
      [
        {
          sku: 'SKU-A',
          statementQuantity: 5,
          invoiceQuantity: 5,
          statementExtendedAmountCents: 4000,
          invoiceExtendedAmountCents: 3000,
        },
        {
          sku: 'SKU-B',
          statementQuantity: 2,
          invoiceQuantity: 2,
          statementExtendedAmountCents: 2000,
          invoiceExtendedAmountCents: 1000,
        },
      ],
      900,
    );

    expect(allocations.reduce((sum: number, value: number) => sum + value, 0)).toBe(900);
    expect(allocations[0]).toBeGreaterThan(allocations[1]);
  });

  it('updates moving-average valuation from prior stock plus landed purchase cost', () => {
    const movingAverage = (service as any).computeMovingAverageCost(10, 1200, 5, 7000);
    expect(movingAverage).toBe(1267);
  });

  it('updates payment-plan status transactionally and writes an audit record', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce(
          queryResult([
            {
              id: 'plan-1',
              supplier_name: 'North Pier Press',
              status: 'PENDING',
              updated_at: '2026-04-01T00:00:00.000Z',
              statement_reference: 'STMT-1',
              invoice_reference: 'INV-1',
            },
          ]),
        )
        .mockResolvedValueOnce(
          queryResult([
            {
              id: 'plan-1',
              status: 'MATCHED',
              updated_at: '2026-04-01T00:01:00.000Z',
            },
          ]),
        ),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );
    auditService.write.mockResolvedValue(undefined);

    const result = await service.updatePaymentPlanStatus(
      {
        id: 'manager-1',
        username: 'manager.li',
        role: 'MANAGER',
        workspace: 'admin',
      },
      'trace-plan-1',
      'plan-1',
      { status: 'MATCHED' },
    );

    expect(result).toEqual({
      id: 'plan-1',
      status: 'MATCHED',
      updatedAt: '2026-04-01T00:01:00.000Z',
    });
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-plan-1',
        action: 'PAYMENT_PLAN_STATUS_UPDATED',
        entityId: 'plan-1',
        payload: expect.objectContaining({
          previousStatus: 'PENDING',
          status: 'MATCHED',
        }),
      }),
      transactionClient,
    );
  });

  it('rejects invalid payment-plan status transitions', async () => {
    const transactionClient = {
      query: jest.fn().mockResolvedValueOnce(
        queryResult([
          {
            id: 'plan-1',
            supplier_name: 'North Pier Press',
            status: 'PAID',
            updated_at: '2026-04-01T00:00:00.000Z',
            statement_reference: 'STMT-1',
            invoice_reference: 'INV-1',
          },
        ]),
      ),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );

    await expect(
      service.updatePaymentPlanStatus(
        {
          id: 'finance-1',
          username: 'finance.zoe',
          role: 'FINANCE',
          workspace: 'finance',
        },
        'trace-plan-2',
        'plan-1',
        { status: 'MATCHED' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(auditService.write).not.toHaveBeenCalled();
  });

  it('updates discrepancy status transactionally and writes an audit record', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce(
          queryResult([
            {
              id: 'disc-1',
              sku: 'SKU-QH-PRINT',
              status: 'OPEN',
              updated_at: '2026-04-01T00:00:00.000Z',
              statement_reference: 'STMT-1',
              invoice_reference: 'INV-1',
            },
          ]),
        )
        .mockResolvedValueOnce(
          queryResult([
            {
              id: 'disc-1',
              status: 'UNDER_REVIEW',
              updated_at: '2026-04-01T00:02:00.000Z',
            },
          ]),
        ),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );
    auditService.write.mockResolvedValue(undefined);

    const result = await service.updateDiscrepancyStatus(
      {
        id: 'inventory-1',
        username: 'inventory.ivan',
        role: 'INVENTORY_MANAGER',
        workspace: 'admin',
      },
      'trace-disc-1',
      'disc-1',
      { status: 'UNDER_REVIEW' },
    );

    expect(result).toEqual({
      id: 'disc-1',
      status: 'UNDER_REVIEW',
      updatedAt: '2026-04-01T00:02:00.000Z',
    });
    expect(auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-disc-1',
        action: 'RECONCILIATION_DISCREPANCY_STATUS_UPDATED',
        entityId: 'disc-1',
        payload: expect.objectContaining({
          previousStatus: 'OPEN',
          status: 'UNDER_REVIEW',
          sku: 'SKU-QH-PRINT',
        }),
      }),
      transactionClient,
    );
  });

  it('returns not-found for missing discrepancy status targets', async () => {
    const transactionClient = {
      query: jest.fn().mockResolvedValueOnce(queryResult([])),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );

    await expect(
      service.updateDiscrepancyStatus(
        {
          id: 'inventory-1',
          username: 'inventory.ivan',
          role: 'INVENTORY_MANAGER',
          workspace: 'admin',
        },
        'trace-disc-2',
        'missing-discrepancy',
        { status: 'UNDER_REVIEW' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(auditService.write).not.toHaveBeenCalled();
  });

  it('propagates import manifest errors inside the transaction without writing audit rows', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce(queryResult([{ id: 'statement-1' }]))
        .mockResolvedValueOnce(queryResult([{ id: 'invoice-1' }]))
        .mockResolvedValueOnce(queryResult([])),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );

    await expect(
      service.importManifest(
        {
          id: 'manager-1',
          username: 'manager.li',
          role: 'MANAGER',
          workspace: 'admin',
        },
        'trace-import-1',
        {
          supplierName: 'Rollback Press',
          sourceFilename: 'rollback.json',
          statementReference: 'STMT-ROLLBACK-UNIT',
          invoiceReference: 'INV-ROLLBACK-UNIT',
          freightCents: 100,
          surchargeCents: 50,
          paymentPlanStatus: 'PENDING',
          items: [
            {
              sku: 'SKU-MISSING',
              statementQuantity: 5,
              invoiceQuantity: 5,
              statementExtendedAmountCents: 1000,
              invoiceExtendedAmountCents: 1000,
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(databaseService.withTransaction).toHaveBeenCalledTimes(1);
    expect(auditService.write).not.toHaveBeenCalled();
  });
});
