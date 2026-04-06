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

export interface HashChainIssue {
  rowId: string;
  reason: string;
}

export interface HashChainVerificationResult {
  valid: boolean;
  checkedEntries: number;
  issues: HashChainIssue[];
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
      'SELECT current_hash FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 1',
    );
    const previousHash = previous.rows[0]?.current_hash ?? null;
    const createdAt = new Date().toISOString();
    const chainPayload = {
      ...input,
      createdAt,
    };
    const currentHash = this.securityService.hashChain(chainPayload, previousHash);
    const chainSignature = this.securityService.signChain(
      'audit',
      chainPayload,
      previousHash,
      currentHash,
    );

    await db.query(
      `
      INSERT INTO audit_logs (
        trace_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        payload,
        previous_hash,
        current_hash,
        chain_signature,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
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
        chainSignature,
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

  async verifyIntegrity(queryable: Queryable = this.databaseService): Promise<HashChainVerificationResult> {
    const result = await queryable.query<{
      id: string;
      trace_id: string;
      actor_user_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      payload: Record<string, unknown>;
      previous_hash: string | null;
      current_hash: string;
      chain_signature: string | null;
      created_at: Date | string;
    }>(
      `
      SELECT id,
             trace_id,
             actor_user_id,
             action,
             entity_type,
             entity_id,
             payload,
             previous_hash,
             current_hash,
             chain_signature,
             created_at
      FROM audit_logs
      ORDER BY created_at ASC, id ASC
      `,
    );

    const issues: HashChainIssue[] = [];
    let previousHash: string | null = null;

    for (const row of result.rows) {
      if (row.previous_hash !== previousHash) {
        issues.push({
          rowId: row.id,
          reason: 'previous_hash does not match the preceding audit log entry.',
        });
      }

      const chainPayload = {
        traceId: row.trace_id,
        actorUserId: row.actor_user_id,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        payload: row.payload,
        createdAt: new Date(row.created_at).toISOString(),
      };
      const expectedHash = this.securityService.hashChain(chainPayload, row.previous_hash);

      if (row.current_hash !== expectedHash) {
        issues.push({
          rowId: row.id,
          reason: 'current_hash does not match the stored audit payload.',
        });
      }

      if (!row.chain_signature) {
        issues.push({
          rowId: row.id,
          reason: 'chain_signature is missing for this audit log entry.',
        });
      } else {
        const expectedSignature = this.securityService.signChain(
          'audit',
          chainPayload,
          row.previous_hash,
          row.current_hash,
        );
        if (row.chain_signature !== expectedSignature) {
          issues.push({
            rowId: row.id,
            reason: 'chain_signature does not match the stored audit payload.',
          });
        }
      }

      previousHash = row.current_hash;
    }

    return {
      valid: issues.length === 0,
      checkedEntries: result.rows.length,
      issues,
    };
  }
}
