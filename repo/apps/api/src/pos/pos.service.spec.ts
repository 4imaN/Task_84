import { ConflictException } from '@nestjs/common';
import { PosService } from './pos.service';

const queryResult = <T>(rows: T[]) => ({ rows });

describe('PosService', () => {
  const databaseService = {
    query: jest.fn(),
    withTransaction: jest.fn(),
  };
  const auditService = {
    write: jest.fn(),
  };
  const securityService = {
    encryptAtRest: jest.fn((value: string) => `cipher:${value}`),
    hashChain: jest.fn(() => 'review-signature'),
  };

  let service: PosService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PosService(
      databaseService as never,
      auditService as never,
      securityService as never,
    );
  });

  it('stores a fresh review snapshot before checkout', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce(queryResult([{ id: 'cart-1', status: 'OPEN' }]))
        .mockResolvedValueOnce(
          queryResult([
            {
              cart_item_id: 'line-1',
              inventory_item_id: 'inventory-1',
              sku: 'SKU-BKMK-01',
              name: 'Archive Atlas Bookmark',
              quantity: 2,
              price_cents: 399,
              on_hand: 40,
              freight_cents: 20,
              surcharge_cents: 10,
              moving_average_cost_cents: 90,
            },
          ]),
        )
        .mockResolvedValueOnce(queryResult([]))
        .mockResolvedValueOnce(queryResult([]))
        .mockResolvedValueOnce(queryResult([{ reviewed_at: '2026-03-28T12:00:00.000Z' }])),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );
    auditService.write.mockResolvedValue(undefined);

    const result = await service.reviewTotal(
      {
        id: 'clerk-1',
        username: 'clerk.emma',
        role: 'CLERK',
        workspace: 'pos',
      },
      'trace-1',
      'cart-1',
    );

    expect(result.reviewReady).toBe(true);
    expect(result.total).toBeGreaterThan(0);
    expect(transactionClient.query).toHaveBeenCalledWith(
      expect.stringContaining('SET review_signature = $2'),
      expect.arrayContaining(['cart-1', 'review-signature']),
    );
  });

  it('rejects checkout when no fresh review snapshot exists', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce(
          queryResult([
            {
              status: 'OPEN',
              review_signature: null,
              reviewed_total_cents: null,
            },
          ]),
        ),
    };
    databaseService.withTransaction.mockImplementation(async (runner: (client: typeof transactionClient) => Promise<unknown>) =>
      runner(transactionClient),
    );

    await expect(
      service.checkout(
        {
          id: 'clerk-1',
          username: 'clerk.emma',
          role: 'CLERK',
          workspace: 'pos',
        },
        'trace-2',
        'cart-1',
        {
          paymentMethod: 'CASH',
          paymentNote: 'test',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(auditService.write).not.toHaveBeenCalled();
  });

  it('clears review state when a cart line quantity is updated', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce(queryResult([{ id: 'cart-1', status: 'OPEN' }]))
        .mockResolvedValueOnce(queryResult([{ id: 'line-1' }]))
        .mockResolvedValueOnce(queryResult([]))
        .mockResolvedValueOnce(queryResult([]))
        .mockResolvedValueOnce(
          queryResult([
            {
              cart_item_id: 'line-1',
              inventory_item_id: 'inventory-1',
              sku: 'SKU-BKMK-01',
              name: 'Archive Atlas Bookmark',
              quantity: 1,
              price_cents: 399,
              on_hand: 40,
              freight_cents: 20,
              surcharge_cents: 10,
              moving_average_cost_cents: 90,
            },
          ]),
        )
        .mockResolvedValueOnce(queryResult([]))
        .mockResolvedValueOnce(queryResult([])),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );
    auditService.write.mockResolvedValue(undefined);

    const result = await service.updateItem(
      {
        id: 'clerk-1',
        username: 'clerk.emma',
        role: 'CLERK',
        workspace: 'pos',
      },
      'trace-3',
      'cart-1',
      'line-1',
      {
        quantity: 1,
      },
    );

    expect(result.reviewReady).toBe(false);
    expect(result.items[0]?.cartItemId).toBe('line-1');
    expect(transactionClient.query).toHaveBeenCalledWith(
      expect.stringContaining('review_signature = NULL'),
      ['cart-1'],
    );
  });

  it('clears review state when a cart line is removed', async () => {
    const transactionClient = {
      query: jest
        .fn()
        .mockResolvedValueOnce(queryResult([{ id: 'cart-1', status: 'OPEN' }]))
        .mockResolvedValueOnce(queryResult([{ id: 'line-1' }]))
        .mockResolvedValueOnce(queryResult([]))
        .mockResolvedValueOnce(queryResult([]))
        .mockResolvedValueOnce(queryResult([])),
    };
    databaseService.withTransaction.mockImplementation(
      async (runner: (client: typeof transactionClient) => Promise<unknown>) => runner(transactionClient),
    );
    auditService.write.mockResolvedValue(undefined);

    const result = await service.deleteItem(
      {
        id: 'clerk-1',
        username: 'clerk.emma',
        role: 'CLERK',
        workspace: 'pos',
      },
      'trace-4',
      'cart-1',
      'line-1',
    );

    expect(result.reviewReady).toBe(false);
    expect(result.items).toEqual([]);
    expect(transactionClient.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM cart_items'),
      ['line-1', 'cart-1'],
    );
  });
});
