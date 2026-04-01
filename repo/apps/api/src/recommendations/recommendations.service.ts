import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import type { RecommendationModel } from '../graphql/models';

interface CacheEntry {
  expiresAt: number;
  value: RecommendationModel;
}

@Injectable()
export class RecommendationsService implements OnModuleInit {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly databaseService: DatabaseService) {}

  async onModuleInit() {
    await this.refreshSnapshots();
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async refreshSnapshots() {
    const titles = await this.databaseService.query<{
      id: string;
      author_id: string;
      series_id: string | null;
      bestseller_rank: number;
    }>('SELECT id, author_id, series_id, bestseller_rank FROM titles');

    const rows = titles.rows;
    for (const title of rows) {
      const similar = rows
        .filter(
          (candidate: {
            id: string;
            author_id: string;
            series_id: string | null;
            bestseller_rank: number;
          }) =>
            candidate.id !== title.id &&
            (candidate.author_id === title.author_id || candidate.series_id === title.series_id),
        )
        .sort(
          (
            left: { bestseller_rank: number },
            right: { bestseller_rank: number },
          ) => left.bestseller_rank - right.bestseller_rank,
        )
        .slice(0, 5)
        .map((candidate: { id: string }) => candidate.id);

      const topN = rows
        .filter((candidate: { id: string }) => candidate.id !== title.id)
        .sort(
          (
            left: { bestseller_rank: number },
            right: { bestseller_rank: number },
          ) => left.bestseller_rank - right.bestseller_rank,
        )
        .slice(0, 5)
        .map((candidate: { id: string }) => candidate.id);

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

  private async writeTrace(traceId: string, titleId: string, strategy: string) {
    await this.databaseService.query(
      `
      INSERT INTO recommendation_traces (trace_id, title_id, strategy)
      VALUES ($1, $2, $3)
      `,
      [traceId, titleId, strategy],
    );
  }

  private async loadSnapshotData(titleId: string): Promise<{
    reason: RecommendationModel['reason'];
    recommendedTitleIds: string[];
  }> {
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
    return {
      reason: similar?.recommended_title_ids?.length ? 'SIMILAR' : 'TOP_N',
      recommendedTitleIds: similar?.recommended_title_ids ?? topN?.recommended_title_ids ?? [],
    };
  }

  private async fallback(titleId: string, traceId: string): Promise<RecommendationModel> {
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

    await this.writeTrace(traceId, titleId, 'BESTSELLER_FALLBACK');

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
          resolve(await this.fallback(titleId, traceId));
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
