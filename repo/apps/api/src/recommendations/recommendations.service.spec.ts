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

  it('refreshes similarity snapshots without treating null series ids as a shared-series match', async () => {
    const snapshotWrites: Array<{
      titleId: string;
      snapshotType: 'SIMILAR' | 'TOP_N';
      recommendedTitleIds: string[];
    }> = [];

    databaseService.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT id, author_id, series_id, bestseller_rank FROM titles')) {
        return {
          rows: [
            { id: 'title-a', author_id: 'author-1', series_id: null, bestseller_rank: 1 },
            { id: 'title-b', author_id: 'author-1', series_id: null, bestseller_rank: 2 },
            { id: 'title-c', author_id: 'author-2', series_id: null, bestseller_rank: 3 },
            { id: 'title-d', author_id: 'author-3', series_id: 'series-1', bestseller_rank: 4 },
            { id: 'title-e', author_id: 'author-4', series_id: 'series-1', bestseller_rank: 5 },
            { id: 'title-f', author_id: 'author-5', series_id: 'series-2', bestseller_rank: 6 },
          ],
        };
      }

      if (sql.includes('INSERT INTO recommendation_snapshots')) {
        snapshotWrites.push({
          titleId: params?.[0] as string,
          snapshotType: sql.includes("'SIMILAR'") ? 'SIMILAR' : 'TOP_N',
          recommendedTitleIds: JSON.parse(String(params?.[1] ?? '[]')) as string[],
        });
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await service.refreshSnapshots();

    const getSnapshot = (titleId: string, snapshotType: 'SIMILAR' | 'TOP_N') =>
      snapshotWrites.find((entry) => entry.titleId === titleId && entry.snapshotType === snapshotType);

    expect(getSnapshot('title-a', 'SIMILAR')?.recommendedTitleIds).toEqual(['title-b']);
    expect(getSnapshot('title-b', 'SIMILAR')?.recommendedTitleIds).toEqual(['title-a']);
    expect(getSnapshot('title-c', 'SIMILAR')?.recommendedTitleIds).toEqual([]);
    expect(getSnapshot('title-d', 'SIMILAR')?.recommendedTitleIds).toEqual(['title-e']);
    expect(getSnapshot('title-e', 'SIMILAR')?.recommendedTitleIds).toEqual(['title-d']);
    expect(getSnapshot('title-f', 'SIMILAR')?.recommendedTitleIds).toEqual([]);
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
      ['fallback-trace', 'title-1', 'TIMEOUT_FALLBACK'],
    );
  });

  it('falls back to best sellers when recommendation snapshots are missing', async () => {
    databaseService.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM recommendation_snapshots')) {
        return { rows: [] };
      }

      if (sql.includes('SELECT id') && sql.includes('FROM titles')) {
        return {
          rows: [{ id: 'title-2' }, { id: 'title-3' }],
        };
      }

      if (sql.includes('INSERT INTO recommendation_traces')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const recommendation = await service.getRecommendations('title-1', 'missing-snapshot-trace');

    expect(recommendation).toEqual({
      titleId: 'title-1',
      reason: 'BESTSELLER_FALLBACK',
      recommendedTitleIds: ['title-2', 'title-3'],
      traceId: 'missing-snapshot-trace',
    });
    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO recommendation_traces'),
      ['missing-snapshot-trace', 'title-1', 'EMPTY_SNAPSHOT_FALLBACK'],
    );
  });

  it('falls back to best sellers when recommendation snapshots resolve to empty arrays', async () => {
    databaseService.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM recommendation_snapshots')) {
        return {
          rows: [
            { snapshot_type: 'SIMILAR', recommended_title_ids: [] },
            { snapshot_type: 'TOP_N', recommended_title_ids: [] },
          ],
        };
      }

      if (sql.includes('SELECT id') && sql.includes('FROM titles')) {
        return {
          rows: [{ id: 'title-2' }, { id: 'title-3' }],
        };
      }

      if (sql.includes('INSERT INTO recommendation_traces')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const recommendation = await service.getRecommendations('title-1', 'empty-snapshot-trace');

    expect(recommendation).toEqual({
      titleId: 'title-1',
      reason: 'BESTSELLER_FALLBACK',
      recommendedTitleIds: ['title-2', 'title-3'],
      traceId: 'empty-snapshot-trace',
    });
    expect(databaseService.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO recommendation_traces'),
      ['empty-snapshot-trace', 'title-1', 'EMPTY_SNAPSHOT_FALLBACK'],
    );
  });
});
