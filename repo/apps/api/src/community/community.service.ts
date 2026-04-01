import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SessionUser } from '@ledgerread/contracts';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
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

  private async ensureTitleExists(titleId: string) {
    const result = await this.databaseService.query<{ id: string }>(
      'SELECT id FROM titles WHERE id = $1',
      [titleId],
    );
    if (!result.rows[0]) {
      throw new NotFoundException('Title not found.');
    }
  }

  async createComment(user: SessionUser, traceId: string, input: CreateCommentDto) {
    await this.ensureTitleExists(input.titleId);
    if (input.parentCommentId) {
      const parent = await this.databaseService.query<{ id: string; title_id: string }>(
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

    const recentCount = await this.databaseService.query<{ count: string }>(
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

    const duplicateFingerprint = normalizeFingerprint(input.titleId, input.body);
    const duplicate = await this.databaseService.query<{ id: string }>(
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

    const words = await this.databaseService.query<{ word: string }>('SELECT word FROM sensitive_words');
    const loweredBody = input.body.toLowerCase();
    const foundWord = words.rows.find((row: { word: string }) => loweredBody.includes(row.word.toLowerCase()));
    if (foundWord) {
      throw new ConflictException(`The comment contains a sensitive term: ${foundWord.word}.`);
    }

    const inserted = await this.databaseService.query<{ id: string; created_at: string }>(
      `
      INSERT INTO comments (title_id, user_id, parent_comment_id, comment_type, body, duplicate_fingerprint)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, created_at
      `,
      [input.titleId, user.id, input.parentCommentId ?? null, input.commentType, input.body, duplicateFingerprint],
    );

    const commentId = inserted.rows[0]!.id;
    await this.auditService.write({
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
    });

    return {
      id: commentId,
      createdAt: inserted.rows[0]!.created_at,
    };
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
