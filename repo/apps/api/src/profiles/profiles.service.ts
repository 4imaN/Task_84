import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '@ledgerread/contracts';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { SecurityService } from '../security/security.service';
import type { UpsertReadingProfileDto, SyncReadingProfileDto } from './dto/reading-preferences.dto';

@Injectable()
export class ProfilesService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly securityService: SecurityService,
  ) {}

  private async queryProfileByUserId(userId: string) {
    const result = await this.databaseService.query<{
      user_id: string;
      username: string | null;
      username_cipher: string | null;
      device_label: string;
      preferences: Record<string, unknown>;
      updated_at: string;
    }>(
      `
      SELECT users.id AS user_id,
             users.username,
             users.username_cipher,
             reading_profiles.device_label,
             reading_profiles.preferences,
             reading_profiles.updated_at
      FROM reading_profiles
      JOIN users ON users.id = reading_profiles.user_id
      WHERE users.id = $1
      `,
      [userId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException('Reading profile not found.');
    }

    return {
      userId: row.user_id,
      username: row.username_cipher
        ? this.securityService.decryptAtRest(row.username_cipher)
        : row.username ?? 'unknown-user',
      deviceLabel: row.device_label,
      preferences: row.preferences,
      updatedAt: row.updated_at,
    };
  }

  async getMine(userId: string) {
    return this.queryProfileByUserId(userId);
  }

  private async getExistingProfileOrNull(userId: string) {
    try {
      return await this.getMine(userId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }

      throw error;
    }
  }

  async updateMine(user: SessionUser, traceId: string, input: UpsertReadingProfileDto) {
    const existing = await this.getExistingProfileOrNull(user.id);
    if (existing && new Date(existing.updatedAt).getTime() > new Date(input.preferences.updatedAt).getTime()) {
      throw new ConflictException({
        message: 'A newer reading profile already exists on the server.',
        serverProfile: existing,
      });
    }

    const result = await this.databaseService.query<{
      user_id: string;
    }>(
      `
      INSERT INTO reading_profiles (user_id, device_label, preferences, updated_at)
      VALUES ($1, $2, $3::jsonb, $4)
      ON CONFLICT (user_id)
      DO UPDATE SET device_label = EXCLUDED.device_label,
                    preferences = EXCLUDED.preferences,
                    updated_at = EXCLUDED.updated_at
      RETURNING user_id
      `,
      [user.id, input.deviceLabel, JSON.stringify(input.preferences), input.preferences.updatedAt],
    );

    await this.auditService.write({
      traceId,
      actorUserId: user.id,
      action: 'READING_PROFILE_UPDATED',
      entityType: 'reading_profile',
      entityId: result.rows[0]!.user_id,
      payload: {
        deviceLabel: input.deviceLabel,
        updatedAt: input.preferences.updatedAt,
      },
    });

    return this.getMine(user.id);
  }

  async syncMine(user: SessionUser, traceId: string, input: SyncReadingProfileDto) {
    const existing = await this.getExistingProfileOrNull(user.id);

    if (existing && new Date(existing.updatedAt).getTime() > new Date(input.preferences.updatedAt).getTime()) {
      if (input.strict) {
        throw new ConflictException({
          message: 'A newer reading profile already exists on the server.',
          serverProfile: existing,
        });
      }

      return {
        resolution: 'SERVER_WON',
        profile: existing,
      };
    }

    const profile = await this.updateMine(user, traceId, input);
    return {
      resolution: existing ? 'CLIENT_WON' : 'CREATED',
      profile,
    };
  }
}
