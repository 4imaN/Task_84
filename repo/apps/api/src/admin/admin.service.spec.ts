import { AdminService } from './admin.service';

describe('AdminService', () => {
  const databaseService = {
    query: jest.fn(),
    withTransaction: jest.fn(),
  };
  const auditService = {
    write: jest.fn(),
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
});
