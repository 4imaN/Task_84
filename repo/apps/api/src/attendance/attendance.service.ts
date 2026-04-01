import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SessionUser } from '@ledgerread/contracts';
import type { AppConfig } from '../config/app-config';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type Queryable } from '../database/database.service';
import { SecurityService } from '../security/security.service';
import type { AttendanceDto } from './dto/attendance.dto';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const RIFF_SIGNATURE = Buffer.from('RIFF');
const WEBP_SIGNATURE = Buffer.from('WEBP');

const detectEvidenceType = (buffer: Buffer) => {
  if (buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { mimeType: 'image/png', extension: 'png' };
  }

  if (buffer.length >= JPEG_SIGNATURE.length && buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).equals(RIFF_SIGNATURE) &&
    buffer.subarray(8, 12).equals(WEBP_SIGNATURE)
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }

  return null;
};

export interface UploadedEvidenceFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly databaseService: DatabaseService,
    private readonly securityService: SecurityService,
    private readonly auditService: AuditService,
  ) {}

  private writeAttendanceLog(
    level: 'log' | 'warn',
    event: string,
    context: Record<string, string | number | undefined>,
  ) {
    const details = Object.entries(context)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    this.logger[level](`ATTENDANCE_${event}${details ? ` ${details}` : ''}`);
  }

  private async getRuleVersionId(ruleKey: string, queryable: Queryable = this.databaseService) {
    const result = await queryable.query<{ id: string }>(
      `
      SELECT id
      FROM rule_versions
      WHERE rule_key = $1
      ORDER BY version DESC
      LIMIT 1
      `,
      [ruleKey],
    );

    return result.rows[0]?.id ?? null;
  }

  async evaluateOverdueClockOuts(userId?: string, queryable: Queryable = this.databaseService) {
    const ruleVersionId = await this.getRuleVersionId('missing-clock-out', queryable);
    if (!ruleVersionId) {
      this.logger.warn('Skipping missing clock-out evaluation because no rule version is configured.');
      return 0;
    }

    const inserted = await queryable.query(
      `
      INSERT INTO risk_alerts (attendance_record_id, rule_version_id, description)
      SELECT attendance_records.id, $1, 'Missing clock-out after 12 hours.'
      FROM attendance_records
      WHERE attendance_records.event_type = 'CLOCK_IN'
        AND attendance_records.occurred_at <= NOW() - INTERVAL '12 hours'
        AND ($2::uuid IS NULL OR attendance_records.user_id = $2)
        AND NOT EXISTS (
          SELECT 1
          FROM attendance_records AS clock_out
          WHERE clock_out.user_id = attendance_records.user_id
            AND clock_out.event_type = 'CLOCK_OUT'
            AND clock_out.occurred_at > attendance_records.occurred_at
        )
        AND NOT EXISTS (
          SELECT 1
          FROM risk_alerts
          WHERE risk_alerts.attendance_record_id = attendance_records.id
            AND risk_alerts.description = 'Missing clock-out after 12 hours.'
        )
      `,
      [ruleVersionId, userId ?? null],
    );

    return inserted.rowCount ?? 0;
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async runScheduledOverdueClockOutEvaluation() {
    const insertedCount = await this.evaluateOverdueClockOuts();
    if (insertedCount > 0) {
      this.writeAttendanceLog('warn', 'OVERDUE_SCAN', {
        traceId: 'system',
        insertedCount,
      });
    }
  }

  private async persistEvidence(traceId: string, file?: UploadedEvidenceFile) {
    if (!file) {
      return null;
    }

    const detectedType = detectEvidenceType(file.buffer);
    if (!detectedType) {
      this.writeAttendanceLog('warn', 'EVIDENCE_REJECTED', {
        traceId,
        reason: 'invalid_signature',
        declaredMimeType: file.mimetype,
      });
      throw new BadRequestException('Evidence file signature is not allowed.');
    }

    const storageRoot = resolve(this.configService.get('evidenceStorageRoot', { infer: true }));
    await mkdir(storageRoot, { recursive: true });

    const checksum = this.securityService.checksum(file.buffer);
    const generatedFilename = `${Date.now()}-${randomUUID()}.${detectedType.extension}`;
    const filePath = resolve(join(storageRoot, generatedFilename));
    if (filePath !== storageRoot && !filePath.startsWith(`${storageRoot}/`)) {
      this.writeAttendanceLog('warn', 'EVIDENCE_REJECTED', {
        traceId,
        reason: 'path_escape',
      });
      throw new BadRequestException('Evidence path could not be secured.');
    }

    await writeFile(filePath, file.buffer);

    return {
      evidencePath: filePath,
      evidenceMimeType: detectedType.mimeType,
      evidenceChecksum: checksum,
    };
  }

  private async appendRecord(
    user: SessionUser,
    traceId: string,
    eventType: 'CLOCK_IN' | 'CLOCK_OUT',
    body: AttendanceDto,
    file?: UploadedEvidenceFile,
  ) {
    if (body.expectedChecksum && !file) {
      throw new BadRequestException('expectedChecksum requires an evidence file.');
    }

    const evidence = await this.persistEvidence(traceId, file);
    return this.databaseService.withTransaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['attendance_records']);
      const previous = await client.query<{ current_hash: string }>(
        'SELECT current_hash FROM attendance_records ORDER BY created_at DESC LIMIT 1',
      );
      const previousHash = previous.rows[0]?.current_hash ?? null;
      const payload = {
        userId: user.id,
        eventType,
        occurredAt: body.occurredAt,
        evidenceChecksum: evidence?.evidenceChecksum ?? null,
      };
      const currentHash = this.securityService.hashChain(payload, previousHash);

      const inserted = await client.query<{ id: string }>(
        `
        INSERT INTO attendance_records (user_id, event_type, occurred_at, evidence_path, evidence_mime_type, evidence_checksum, previous_hash, current_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
        `,
        [
          user.id,
          eventType,
          body.occurredAt,
          evidence?.evidencePath ?? null,
          evidence?.evidenceMimeType ?? null,
          evidence?.evidenceChecksum ?? null,
          previousHash,
          currentHash,
        ],
      );

      if (body.expectedChecksum && evidence && body.expectedChecksum !== evidence.evidenceChecksum) {
        const ruleVersionId = await this.getRuleVersionId('evidence-file-mismatch', client);
        await client.query(
          `
          INSERT INTO risk_alerts (attendance_record_id, rule_version_id, description)
          VALUES ($1, $2, $3)
          `,
          [inserted.rows[0]!.id, ruleVersionId, 'Evidence file checksum mismatch.'],
        );
        this.writeAttendanceLog('warn', 'CHECKSUM_MISMATCH', {
          traceId,
          recordId: inserted.rows[0]!.id,
        });
      }

      await this.evaluateOverdueClockOuts(user.id, client);
      await this.auditService.write({
        traceId,
        actorUserId: user.id,
        action: `ATTENDANCE_${eventType}`,
        entityType: 'attendance_record',
        entityId: inserted.rows[0]!.id,
        payload,
      }, client);

      this.writeAttendanceLog('log', 'RECORDED', {
        traceId,
        eventType,
        userId: user.id,
        recordId: inserted.rows[0]!.id,
      });

      return { recordId: inserted.rows[0]!.id };
    });
  }

  clockIn(user: SessionUser, traceId: string, body: AttendanceDto, file?: UploadedEvidenceFile) {
    return this.appendRecord(user, traceId, 'CLOCK_IN', body, file);
  }

  clockOut(user: SessionUser, traceId: string, body: AttendanceDto, file?: UploadedEvidenceFile) {
    return this.appendRecord(user, traceId, 'CLOCK_OUT', body, file);
  }

  async getRiskAlerts(user: SessionUser) {
    await this.evaluateOverdueClockOuts(user.id);
    const isClerk = user.role === 'CLERK';
    const result = await this.databaseService.query<{
      id: string;
      description: string;
      status: string;
      created_at: string;
      username: string | null;
      username_cipher: string | null;
    }>(
      `
      SELECT risk_alerts.id,
             risk_alerts.description,
             risk_alerts.status,
             risk_alerts.created_at,
             users.username,
             users.username_cipher
      FROM risk_alerts
      JOIN attendance_records ON attendance_records.id = risk_alerts.attendance_record_id
      JOIN users ON users.id = attendance_records.user_id
      WHERE ($1::boolean = FALSE OR attendance_records.user_id = $2)
      ORDER BY risk_alerts.created_at DESC
      `,
      [isClerk, user.id],
    );

    return result.rows.map((row) => ({
      ...row,
      username: row.username_cipher
        ? this.securityService.decryptAtRest(row.username_cipher)
        : row.username ?? 'unknown-user',
    }));
  }
}
