import { RecommendationsService } from './recommendations.service';

describe('RecommendationsService', () => {
  const databaseService = {
    query: jest.fn(),
  };

  let service: RecommendationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    service = new RecommendationsService(databaseService as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('records cache-hit traces while returning the cached recommendation payload', async () => {
    (service as any).cache.set('title-1', {
      expiresAt: Date.now() + 60_000,
      value: {
        titleId: 'title-1',
        reason: 'SIMILAR',
        recommendedTitleIds: ['title-2'],
        traceId: 'cached-trace',
      },
    });
    databaseService.query.mockResolvedValue({ rows: [] });

    const recommendation = await service.getRecommendations('title-1', 'new-trace');

    expect(recommendation).toEqual({
      titleId: 'title-1',
      reason: 'SIMILAR',
      recommendedTitleIds: ['title-2'],
      traceId: 'new-trace',
    });
    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO recommendation_traces'),
      ['new-trace', 'title-1', 'CACHE_HIT'],
    );
  });

  it('falls back to best sellers after the 150ms recommendation timeout', async () => {
    jest.useFakeTimers();
    jest.spyOn(service as never, 'loadSnapshotData').mockImplementation(
      () => new Promise(() => undefined) as never,
    );
    databaseService.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id') && sql.includes('FROM titles')) {
        return {
          rows: [{ id: 'title-2' }, { id: 'title-3' }, { id: 'title-4' }],
        };
      }

      if (sql.includes('INSERT INTO recommendation_traces')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const recommendationPromise = service.getRecommendations('title-1', 'timeout-trace');
    await jest.advanceTimersByTimeAsync(151);
    const recommendation = await recommendationPromise;

    expect(recommendation).toEqual({
      titleId: 'title-1',
      reason: 'BESTSELLER_FALLBACK',
      recommendedTitleIds: ['title-2', 'title-3', 'title-4'],
      traceId: 'timeout-trace',
    });
  });

  it('writes a BESTSELLER_FALLBACK trace when the timeout path wins', async () => {
    jest.useFakeTimers();
    jest.spyOn(service as never, 'loadSnapshotData').mockImplementation(
      () => new Promise(() => undefined) as never,
    );
    databaseService.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('SELECT id') && sql.includes('FROM titles')) {
        return {
          rows: [{ id: 'title-2' }],
        };
      }

      if (sql.includes('INSERT INTO recommendation_traces')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const recommendationPromise = service.getRecommendations('title-1', 'fallback-trace');
    await jest.advanceTimersByTimeAsync(151);
    await recommendationPromise;

    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO recommendation_traces'),
      ['fallback-trace', 'title-1', 'BESTSELLER_FALLBACK'],
    );
  });
});
