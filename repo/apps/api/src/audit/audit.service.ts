import { Injectable } from '@nestjs/common';
import { DatabaseService, type Queryable } from '../database/database.service';
import { SecurityService } from '../security/security.service';

interface AuditWriteInput {
  traceId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly securityService: SecurityService,
  ) {}

  private async writeLocked(input: AuditWriteInput, db: Queryable) {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['audit_logs']);
    const previous = await db.query<{ current_hash: string }>(
      'SELECT current_hash FROM audit_logs ORDER BY created_at DESC LIMIT 1',
    );
    const previousHash = previous.rows[0]?.current_hash ?? null;
    const createdAt = new Date().toISOString();
    const currentHash = this.securityService.hashChain(
      {
        ...input,
        createdAt,
      },
      previousHash,
    );

    await db.query(
      `
      INSERT INTO audit_logs (trace_id, actor_user_id, action, entity_type, entity_id, payload, previous_hash, current_hash, created_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
      `,
      [
        input.traceId,
        input.actorUserId,
        input.action,
        input.entityType,
        input.entityId,
        JSON.stringify(input.payload),
        previousHash,
        currentHash,
        createdAt,
      ],
    );
  }

  async write(input: AuditWriteInput, queryable?: Queryable) {
    if (queryable) {
      await this.writeLocked(input, queryable);
      return;
    }

    await this.databaseService.withTransaction(async (client) => {
      await this.writeLocked(input, client);
    });
  }
}
