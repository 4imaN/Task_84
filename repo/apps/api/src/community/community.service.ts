import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SessionUser } from '@ledgerread/contracts';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type Queryable } from '../database/database.service';
import type {
  CreateCommentDto,
  CreateReportDto,
  FavoriteDto,
  RatingDto,
  RelationshipDto,
  SubscribeDto,
} from './dto/community.dto';

const normalizeFingerprint = (titleId: string, body: string) =>
  `${titleId}:${body.trim().toLowerCase().replace(/\s+/g, ' ')}`;

@Injectable()
export class CommunityService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  private async ensureEntityExists(
    table: 'titles' | 'users' | 'authors' | 'series',
    id: string,
    message: string,
    queryable: Queryable = this.databaseService,
  ) {
    const result = await queryable.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE id = $1`,
      [id],
    );
    if (!result.rows[0]) {
      throw new NotFoundException(message);
    }
  }

  private async ensureTitleExists(titleId: string, queryable: Queryable = this.databaseService) {
    await this.ensureEntityExists('titles', titleId, 'Title not found.', queryable);
  }

  private async ensureUserExists(userId: string, queryable: Queryable = this.databaseService) {
    await this.ensureEntityExists('users', userId, 'Target user not found.', queryable);
  }

  private async ensureAuthorExists(authorId: string, queryable: Queryable = this.databaseService) {
    await this.ensureEntityExists('authors', authorId, 'Author not found.', queryable);
  }

  private async ensureSeriesExists(seriesId: string, queryable: Queryable = this.databaseService) {
    await this.ensureEntityExists('series', seriesId, 'Series not found.', queryable);
  }

  async createComment(user: SessionUser, traceId: string, input: CreateCommentDto) {
    const normalizedBody = input.body.trim();

    return this.databaseService.withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`community-comment:${user.id}`]);

      await this.ensureTitleExists(input.titleId, client);
      if (input.parentCommentId) {
        const parent = await client.query<{ id: string; title_id: string }>(
          `
          SELECT id, title_id
          FROM comments
          WHERE id = $1
          `,
          [input.parentCommentId],
        );

        if (!parent.rows[0]) {
          throw new NotFoundException('Parent comment not found.');
        }

        if (parent.rows[0].title_id !== input.titleId) {
          throw new BadRequestException('Replies must stay within the same title thread.');
        }
      }

      const recentCount = await client.query<{ count: string }>(
        `
        SELECT COUNT(*)::text AS count
        FROM comments
        WHERE user_id = $1
          AND created_at >= NOW() - INTERVAL '1 minute'
        `,
        [user.id],
      );

      if (Number(recentCount.rows[0]?.count ?? 0) >= 10) {
        throw new ConflictException('Comment rate limit reached for the current minute.');
      }

      const duplicateFingerprint = normalizeFingerprint(input.titleId, normalizedBody);
      const duplicate = await client.query<{ id: string }>(
        `
        SELECT id
        FROM comments
        WHERE user_id = $1
          AND duplicate_fingerprint = $2
          AND created_at >= NOW() - INTERVAL '60 seconds'
        LIMIT 1
        `,
        [user.id, duplicateFingerprint],
      );

      if (duplicate.rows[0]) {
        throw new ConflictException('Duplicate content detected in the last 60 seconds.');
      }

      const words = await client.query<{ word: string }>('SELECT word FROM sensitive_words');
      const loweredBody = normalizedBody.toLowerCase();
      const foundWord = words.rows.find((row: { word: string }) =>
        loweredBody.includes(row.word.toLowerCase()),
      );
      if (foundWord) {
        throw new ConflictException('The comment contains prohibited content.');
      }

      const inserted = await client.query<{ id: string; created_at: string }>(
        `
        INSERT INTO comments (title_id, user_id, parent_comment_id, comment_type, body, duplicate_fingerprint)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, created_at
        `,
        [
          input.titleId,
          user.id,
          input.parentCommentId ?? null,
          input.commentType,
          normalizedBody,
          duplicateFingerprint,
        ],
      );

      const commentId = inserted.rows[0]!.id;
      await this.auditService.write(
        {
          traceId,
          actorUserId: user.id,
          action: 'COMMENT_CREATED',
          entityType: 'comment',
          entityId: commentId,
          payload: {
            titleId: input.titleId,
            parentCommentId: input.parentCommentId ?? null,
            commentType: input.commentType,
          },
        },
        client,
      );

      return {
        id: commentId,
        createdAt: inserted.rows[0]!.created_at,
      };
    });
  }

  async createReport(user: SessionUser, traceId: string, input: CreateReportDto) {
    const comment = await this.databaseService.query<{ id: string }>(
      'SELECT id FROM comments WHERE id = $1',
      [input.commentId],
    );
    if (!comment.rows[0]) {
      throw new NotFoundException('Comment not found.');
    }

    const report = await this.databaseService.query<{ id: string }>(
      `
      INSERT INTO reports (comment_id, reporter_user_id, category, notes)
      VALUES ($1, $2, $3, $4)
      RETURNING id
      `,
      [input.commentId, user.id, input.category.trim(), input.notes.trim()],
    );

    await this.auditService.write({
      traceId,
      actorUserId: user.id,
      action: 'REPORT_CREATED',
      entityType: 'report',
      entityId: report.rows[0]!.id,
      payload: {
        commentId: input.commentId,
        category: input.category.trim(),
      },
    });

    return { reportId: report.rows[0]!.id };
  }

  private async upsertRelationship(
    table: 'user_blocks' | 'user_mutes',
    sourceColumn: 'blocker_user_id' | 'muter_user_id',
    user: SessionUser,
    traceId: string,
    input: RelationshipDto,
  ) {
    if (input.targetUserId === user.id) {
      const action = table === 'user_blocks' ? 'block' : 'mute';
      throw new BadRequestException(`You cannot ${action} yourself.`);
    }

    await this.ensureUserExists(input.targetUserId);

    if (input.active) {
      await this.databaseService.query(
        `
        INSERT INTO ${table} (${sourceColumn}, ${table === 'user_blocks' ? 'blocked_user_id' : 'muted_user_id'})
        VALUES ($1, $2)
        ON CONFLICT (${sourceColumn}, ${table === 'user_blocks' ? 'blocked_user_id' : 'muted_user_id'}) DO NOTHING
        `,
        [user.id, input.targetUserId],
      );
    } else {
      await this.databaseService.query(
        `
        DELETE FROM ${table}
        WHERE ${sourceColumn} = $1
          AND ${table === 'user_blocks' ? 'blocked_user_id' : 'muted_user_id'} = $2
        `,
        [user.id, input.targetUserId],
      );
    }

    await this.auditService.write({
      traceId,
      actorUserId: user.id,
      action: table === 'user_blocks' ? 'BLOCK_UPDATED' : 'MUTE_UPDATED',
      entityType: table,
      entityId: input.targetUserId,
      payload: {
        active: input.active,
      },
    });
  }

  async updateBlock(user: SessionUser, traceId: string, input: RelationshipDto) {
    await this.upsertRelationship('user_blocks', 'blocker_user_id', user, traceId, input);
    return { ok: true };
  }

  async updateMute(user: SessionUser, traceId: string, input: RelationshipDto) {
    await this.upsertRelationship('user_mutes', 'muter_user_id', user, traceId, input);
    return { ok: true };
  }

  async upsertRating(user: SessionUser, traceId: string, input: RatingDto) {
    await this.ensureTitleExists(input.titleId);
    await this.databaseService.query(
      `
      INSERT INTO ratings (user_id, title_id, rating, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (user_id, title_id)
      DO UPDATE SET rating = EXCLUDED.rating,
                    updated_at = NOW()
      `,
      [user.id, input.titleId, input.rating],
    );

    await this.auditService.write({
      traceId,
      actorUserId: user.id,
      action: 'RATING_UPSERTED',
      entityType: 'rating',
      entityId: `${user.id}:${input.titleId}`,
      payload: { rating: input.rating },
    });

    return { ok: true };
  }

  async updateFavorite(user: SessionUser, traceId: string, input: FavoriteDto) {
    await this.ensureTitleExists(input.titleId);
    if (input.active) {
      await this.databaseService.query(
        `
        INSERT INTO favorites (user_id, title_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, title_id) DO NOTHING
        `,
        [user.id, input.titleId],
      );
    } else {
      await this.databaseService.query('DELETE FROM favorites WHERE user_id = $1 AND title_id = $2', [
        user.id,
        input.titleId,
      ]);
    }

    await this.auditService.write({
      traceId,
      actorUserId: user.id,
      action: 'FAVORITE_UPDATED',
      entityType: 'favorite',
      entityId: input.titleId,
      payload: { active: input.active },
    });

    return { ok: true };
  }

  async updateAuthorSubscription(user: SessionUser, traceId: string, input: SubscribeDto) {
    await this.ensureAuthorExists(input.targetId);

    if (input.active) {
      await this.databaseService.query(
        `
        INSERT INTO author_subscriptions (user_id, author_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, author_id) DO NOTHING
        `,
        [user.id, input.targetId],
      );
    } else {
      await this.databaseService.query(
        'DELETE FROM author_subscriptions WHERE user_id = $1 AND author_id = $2',
        [user.id, input.targetId],
      );
    }

    await this.auditService.write({
      traceId,
      actorUserId: user.id,
      action: 'AUTHOR_SUBSCRIPTION_UPDATED',
      entityType: 'author_subscription',
      entityId: input.targetId,
      payload: { active: input.active },
    });

    return { ok: true };
  }

  async updateSeriesSubscription(user: SessionUser, traceId: string, input: SubscribeDto) {
    await this.ensureSeriesExists(input.targetId);

    if (input.active) {
      await this.databaseService.query(
        `
        INSERT INTO series_subscriptions (user_id, series_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, series_id) DO NOTHING
        `,
        [user.id, input.targetId],
      );
    } else {
      await this.databaseService.query(
        'DELETE FROM series_subscriptions WHERE user_id = $1 AND series_id = $2',
        [user.id, input.targetId],
      );
    }

    await this.auditService.write({
      traceId,
      actorUserId: user.id,
      action: 'SERIES_SUBSCRIPTION_UPDATED',
      entityType: 'series_subscription',
      entityId: input.targetId,
      payload: { active: input.active },
    });

    return { ok: true };
  }
}
