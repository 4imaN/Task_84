import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import type { RecommendationModel } from '../graphql/models';

interface CacheEntry {
  expiresAt: number;
  value: RecommendationModel;
}

type RecommendationTraceStrategy =
  | 'CACHE_HIT'
  | 'SIMILAR'
  | 'TOP_N'
  | 'TIMEOUT_FALLBACK'
  | 'EMPTY_SNAPSHOT_FALLBACK';
type SnapshotRecommendationReason = 'SIMILAR' | 'TOP_N';
type SnapshotTitleRow = {
  id: string;
  author_id: string;
  series_id: string | null;
  bestseller_rank: number;
};

@Injectable()
export class RecommendationsService implements OnModuleInit {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly databaseService: DatabaseService) {}

  private areTitlesSimilar(title: SnapshotTitleRow, candidate: SnapshotTitleRow) {
    if (candidate.id === title.id) {
      return false;
    }

    if (candidate.author_id === title.author_id) {
      return true;
    }

    return Boolean(title.series_id && candidate.series_id && candidate.series_id === title.series_id);
  }

  async onModuleInit() {
    await this.refreshSnapshots();
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async refreshSnapshots() {
    const titles = await this.databaseService.query<SnapshotTitleRow>(
      'SELECT id, author_id, series_id, bestseller_rank FROM titles',
    );

    const rows = titles.rows;
    for (const title of rows) {
      const similar = rows
        .filter((candidate) => this.areTitlesSimilar(title, candidate))
        .sort(
          (left: SnapshotTitleRow, right: SnapshotTitleRow) => left.bestseller_rank - right.bestseller_rank,
        )
        .slice(0, 5)
        .map((candidate: SnapshotTitleRow) => candidate.id);

      const topN = rows
        .filter((candidate: SnapshotTitleRow) => candidate.id !== title.id)
        .sort(
          (left: SnapshotTitleRow, right: SnapshotTitleRow) => left.bestseller_rank - right.bestseller_rank,
        )
        .slice(0, 5)
        .map((candidate: SnapshotTitleRow) => candidate.id);

      await this.databaseService.query(
        `
        INSERT INTO recommendation_snapshots (title_id, snapshot_type, recommended_title_ids, refreshed_at)
        VALUES ($1, 'SIMILAR', $2::jsonb, NOW())
        ON CONFLICT (title_id, snapshot_type)
        DO UPDATE SET recommended_title_ids = EXCLUDED.recommended_title_ids,
                      refreshed_at = NOW()
        `,
        [title.id, JSON.stringify(similar)],
      );

      await this.databaseService.query(
        `
        INSERT INTO recommendation_snapshots (title_id, snapshot_type, recommended_title_ids, refreshed_at)
        VALUES ($1, 'TOP_N', $2::jsonb, NOW())
        ON CONFLICT (title_id, snapshot_type)
        DO UPDATE SET recommended_title_ids = EXCLUDED.recommended_title_ids,
                      refreshed_at = NOW()
        `,
        [title.id, JSON.stringify(topN)],
      );
    }
  }

  private async writeTrace(traceId: string, titleId: string, strategy: RecommendationTraceStrategy) {
    await this.databaseService.query(
      `
      INSERT INTO recommendation_traces (trace_id, title_id, strategy)
      VALUES ($1, $2, $3)
      `,
      [traceId, titleId, strategy],
    );
  }

  private async loadSnapshotData(titleId: string): Promise<{
    reason: SnapshotRecommendationReason;
    recommendedTitleIds: string[];
  } | null> {
    const rows = await this.databaseService.query<{
      snapshot_type: string;
      recommended_title_ids: string[];
    }>(
      `
      SELECT snapshot_type, recommended_title_ids
      FROM recommendation_snapshots
      WHERE title_id = $1
      ORDER BY snapshot_type ASC
      `,
      [titleId],
    );

    const similar = rows.rows.find((row: { snapshot_type: string }) => row.snapshot_type === 'SIMILAR');
    const topN = rows.rows.find((row: { snapshot_type: string }) => row.snapshot_type === 'TOP_N');

    if ((similar?.recommended_title_ids?.length ?? 0) > 0) {
      return {
        reason: 'SIMILAR',
        recommendedTitleIds: similar!.recommended_title_ids,
      };
    }

    if ((topN?.recommended_title_ids?.length ?? 0) > 0) {
      return {
        reason: 'TOP_N',
        recommendedTitleIds: topN!.recommended_title_ids,
      };
    }

    return null;
  }

  private async fallback(
    titleId: string,
    traceId: string,
    strategy: Extract<RecommendationTraceStrategy, 'TIMEOUT_FALLBACK' | 'EMPTY_SNAPSHOT_FALLBACK'>,
  ): Promise<RecommendationModel> {
    const bestSellers = await this.databaseService.query<{ id: string }>(
      `
      SELECT id
      FROM titles
      WHERE id <> $1
      ORDER BY bestseller_rank ASC
      LIMIT 5
      `,
      [titleId],
    );

    await this.writeTrace(traceId, titleId, strategy);

    return {
      titleId,
      reason: 'BESTSELLER_FALLBACK',
      recommendedTitleIds: bestSellers.rows.map((row: { id: string }) => row.id),
      traceId,
    };
  }

  async getRecommendations(titleId: string, traceId: string) {
    const cached = this.cache.get(titleId);
    if (cached && cached.expiresAt > Date.now()) {
      await this.writeTrace(traceId, titleId, 'CACHE_HIT');
      return {
        ...cached.value,
        traceId,
      };
    }

    const recommendation = await new Promise<RecommendationModel>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(async () => {
        try {
          settled = true;
          resolve(await this.fallback(titleId, traceId, 'TIMEOUT_FALLBACK'));
        } catch (error) {
          reject(error);
        }
      }, 150);

      void this.loadSnapshotData(titleId)
        .then(async (value) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (!value) {
            resolve(await this.fallback(titleId, traceId, 'EMPTY_SNAPSHOT_FALLBACK'));
            return;
          }
          await this.writeTrace(traceId, titleId, value.reason);
          resolve({
            titleId,
            reason: value.reason,
            recommendedTitleIds: value.recommendedTitleIds,
            traceId,
          });
        })
        .catch((error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
    });

    this.cache.set(titleId, {
      expiresAt: Date.now() + 10 * 60 * 1000,
      value: recommendation,
    });

    return recommendation;
  }
}
