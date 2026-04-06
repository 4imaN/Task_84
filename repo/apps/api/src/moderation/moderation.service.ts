import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { SessionUser } from '@ledgerread/contracts';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type Queryable } from '../database/database.service';
import type { ModerationActionDto } from './dto/moderation.dto';

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);
  private readonly suspendableRoles = new Set(['CUSTOMER']);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  private normalizeStatus(status?: string) {
    const candidate = status?.toUpperCase();
    if (candidate === 'RESOLVED' || candidate === 'ALL') {
      return candidate;
    }

    return 'OPEN';
  }

  private writeModerationLog(
    event: string,
    context: Record<string, string | undefined>,
  ) {
    const details = Object.entries(context)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    this.logger.log(`MODERATION_${event}${details ? ` ${details}` : ''}`);
  }

  async getQueue(status?: string) {
    const normalizedStatus = this.normalizeStatus(status);
    const params = normalizedStatus === 'ALL' ? [] : [normalizedStatus];

    const reports = await this.databaseService.query<{
      id: string;
      category: string;
      notes: string;
      status: string;
      created_at: string;
      comment_id: string | null;
      comment_body: string | null;
      comment_hidden: boolean | null;
      comment_author_id: string | null;
      comment_author_name: string | null;
      title_name: string | null;
      reporter_name: string;
    }>(
      `
      SELECT reports.id,
             reports.category,
             reports.notes,
             reports.status,
             reports.created_at,
             comments.id AS comment_id,
             comments.body AS comment_body,
             comments.is_hidden AS comment_hidden,
             comment_author.id AS comment_author_id,
             comment_author.display_name AS comment_author_name,
             titles.name AS title_name,
             reporter.display_name AS reporter_name
      FROM reports
      JOIN users AS reporter ON reporter.id = reports.reporter_user_id
      LEFT JOIN comments ON comments.id = reports.comment_id
      LEFT JOIN users AS comment_author ON comment_author.id = comments.user_id
      LEFT JOIN titles ON titles.id = comments.title_id
      ${normalizedStatus === 'ALL' ? '' : 'WHERE reports.status = $1'}
      ORDER BY reports.created_at ASC
      `,
      params,
    );

    return reports.rows;
  }

  private async resolveTargets(input: ModerationActionDto, queryable: Queryable) {
    let reportId = input.reportId ?? null;
    let reportCommentId: string | null = null;
    let reportStatus: string | null = null;
    let targetCommentId = input.targetCommentId ?? null;
    let targetUserId = input.targetUserId ?? null;
    let targetUserRole: string | null = null;

    if (reportId) {
      const report = await queryable.query<{
        id: string;
        status: string;
        comment_id: string | null;
        comment_author_id: string | null;
      }>(
        `
        SELECT reports.id,
               reports.status,
               reports.comment_id,
               comments.user_id AS comment_author_id
        FROM reports
        LEFT JOIN comments ON comments.id = reports.comment_id
        WHERE reports.id = $1
        FOR UPDATE OF reports
        `,
        [reportId],
      );

      const reportRow = report.rows[0];
      if (!reportRow) {
        throw new NotFoundException('Report not found.');
      }

      reportStatus = reportRow.status;
      reportCommentId = reportRow.comment_id;

      if (targetCommentId && reportRow.comment_id && targetCommentId !== reportRow.comment_id) {
        throw new ConflictException('reportId does not match the supplied targetCommentId.');
      }

      if (targetUserId && reportRow.comment_author_id && targetUserId !== reportRow.comment_author_id) {
        throw new ConflictException('reportId does not match the supplied targetUserId.');
      }

      targetCommentId = reportRow.comment_id ?? targetCommentId;
      targetUserId = reportRow.comment_author_id ?? targetUserId;
    }

    if (targetCommentId) {
      const comment = await queryable.query<{
        id: string;
        user_id: string;
      }>(
        `
        SELECT id, user_id
        FROM comments
        WHERE id = $1
        FOR UPDATE
        `,
        [targetCommentId],
      );

      const commentRow = comment.rows[0];
      if (!commentRow) {
        throw new NotFoundException('Comment not found.');
      }

      if (targetUserId && targetUserId !== commentRow.user_id) {
        throw new ConflictException('targetCommentId does not match the supplied targetUserId.');
      }

      targetUserId = commentRow.user_id;
    }

    if (targetUserId) {
      const targetUser = await queryable.query<{ id: string; role: string }>(
        `
        SELECT id, role
        FROM users
        WHERE id = $1
        FOR UPDATE
        `,
        [targetUserId],
      );

      if (!targetUser.rows[0]) {
        throw new NotFoundException('Target user not found.');
      }

      targetUserRole = targetUser.rows[0].role;
    }

    return {
      reportId,
      reportCommentId,
      reportStatus,
      targetCommentId,
      targetUserId,
      targetUserRole,
    };
  }

  async applyAction(user: SessionUser, traceId: string, input: ModerationActionDto) {
    return this.databaseService.withTransaction(async (client) => {
      const resolved = await this.resolveTargets(input, client);
      const actionLabel = input.action.charAt(0).toUpperCase() + input.action.slice(1);

      if ((input.action === 'hide' || input.action === 'restore' || input.action === 'remove') && !resolved.reportId) {
        throw new ConflictException(`${actionLabel} requires a linked moderation report.`);
      }

      if (
        (input.action === 'hide' || input.action === 'restore' || input.action === 'remove') &&
        !resolved.reportCommentId
      ) {
        throw new ConflictException(`${actionLabel} requires a report linked to a comment target.`);
      }

      if (!resolved.targetCommentId && input.action !== 'suspend') {
        throw new ConflictException('A targetCommentId is required for this moderation action.');
      }

      if (input.action === 'suspend' && !resolved.reportId) {
        throw new ConflictException('Suspend requires a linked moderation report.');
      }

      if (input.action === 'suspend' && resolved.reportStatus !== 'OPEN') {
        throw new ConflictException('Suspend requires an OPEN moderation report.');
      }

      if (input.action === 'suspend' && !resolved.targetCommentId) {
        throw new ConflictException('Suspend requires a report linked to a comment target.');
      }

      if (input.action === 'suspend' && !resolved.targetUserId) {
        throw new ConflictException('Suspend requires a resolvable user target.');
      }

      if (
        input.action === 'suspend' &&
        resolved.targetUserRole &&
        !this.suspendableRoles.has(resolved.targetUserRole)
      ) {
        throw new ForbiddenException('Moderation suspend can target customer accounts only.');
      }

      if (input.action === 'hide' && resolved.targetCommentId) {
        await client.query('UPDATE comments SET is_hidden = TRUE WHERE id = $1', [resolved.targetCommentId]);
      }

      if (input.action === 'restore' && resolved.targetCommentId) {
        await client.query('UPDATE comments SET is_hidden = FALSE WHERE id = $1', [resolved.targetCommentId]);
      }

      if (input.action === 'remove' && resolved.targetCommentId) {
        await client.query(
          'UPDATE comments SET is_hidden = TRUE, body = $2 WHERE id = $1',
          [resolved.targetCommentId, '[removed by moderation]'],
        );
      }

      if (input.action === 'suspend' && resolved.targetUserId) {
        await client.query('UPDATE users SET is_suspended = TRUE WHERE id = $1', [resolved.targetUserId]);
      }

      const action = await client.query<{ id: string }>(
        `
        INSERT INTO moderation_actions (moderator_user_id, report_id, target_user_id, target_comment_id, action, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        `,
        [
          user.id,
          resolved.reportId,
          resolved.targetUserId,
          resolved.targetCommentId,
          input.action,
          input.notes,
        ],
      );

      if (resolved.reportId) {
        await client.query('UPDATE reports SET status = $2 WHERE id = $1', [resolved.reportId, 'RESOLVED']);
      }

      await this.auditService.write(
        {
          traceId,
          actorUserId: user.id,
          action: 'MODERATION_ACTION_APPLIED',
          entityType: 'moderation_action',
          entityId: action.rows[0]!.id,
          payload: {
            reportId: resolved.reportId,
            targetUserId: resolved.targetUserId,
            targetCommentId: resolved.targetCommentId,
            action: input.action,
          },
        },
        client,
      );

      this.writeModerationLog('ACTION_APPLIED', {
        traceId,
        moderatorUserId: user.id,
        action: input.action,
        reportId: resolved.reportId ?? 'direct',
        targetUserId: resolved.targetUserId ?? undefined,
        targetCommentId: resolved.targetCommentId ?? undefined,
      });

      return { actionId: action.rows[0]!.id };
    });
  }
}
