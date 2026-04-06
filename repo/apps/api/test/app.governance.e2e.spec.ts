import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MAX_AUDIT_LOG_LIMIT } from '../src/admin/dto/admin.dto';
import { DEFAULT_ATTENDANCE_EVIDENCE_MAX_BYTES } from '../src/config/app-config';
import {
  createIdentifierLookupHash,
  decryptAtRestValue,
  encryptAtRestValue,
} from '../src/security/identifier';

const GRAPHQL = '/graphql';
const APP_ORIGIN = process.env.APP_BASE_URL ?? 'http://localhost:4000';
const CONFIGURED_LAN_ORIGIN = 'http://192.168.50.20:4173';
const DEFAULT_ADMIN_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ledgerread';
const DEFAULT_APP_DATABASE_URL = 'postgresql://ledgerread_app:ledgerread_app@localhost:5432/ledgerread';
const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x01, 0xe5, 0x27, 0xd4, 0xa2, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);
const checksumOf = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const canonicalizeForHash = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeForHash(entry));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((accumulator, [key, entryValue]) => {
        accumulator[key] = canonicalizeForHash(entryValue);
        return accumulator;
      }, {});
  }

  return value;
};
const chainHash = (payload: unknown, previousHash: string | null) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        canonicalizeForHash({
          previousHash,
          payload,
        }),
      ),
    )
    .digest('hex');
const chainSignature = (
  recordType: 'audit' | 'attendance',
  payload: unknown,
  previousHash: string | null,
  currentHash: string,
) => {
  const key = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error('APP_ENCRYPTION_KEY is required for API integration tests.');
  }

  return createHmac('sha256', key)
  .update(
    JSON.stringify(
      canonicalizeForHash({
        recordType,
        previousHash,
        currentHash,
        payload,
      }),
    ),
  )
  .digest('hex');
};

const deriveRuntimeDatabaseUrl = (adminDatabaseUrl: string) => {
  try {
    const parsed = new URL(adminDatabaseUrl);
    parsed.username = 'ledgerread_app';
    parsed.password = 'ledgerread_app';
    return parsed.toString();
  } catch {
    return DEFAULT_APP_DATABASE_URL;
  }
};

describe('LedgerRead API (governance-integrity)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof request>;
  let pool: Pool;
  let runtimePool: Pool | null = null;
  let originalAllowedOriginsEnv: string | undefined;

  const createAuthenticatedAgent = (
    sessionAgent: ReturnType<typeof request.agent>,
    csrfToken: string,
  ) => ({
    get: (url: string) => sessionAgent.get(url),
    post: (url: string) =>
      sessionAgent.post(url).set('x-csrf-token', csrfToken).set('Origin', APP_ORIGIN),
    put: (url: string) =>
      sessionAgent.put(url).set('x-csrf-token', csrfToken).set('Origin', APP_ORIGIN),
    patch: (url: string) =>
      sessionAgent.patch(url).set('x-csrf-token', csrfToken).set('Origin', APP_ORIGIN),
    delete: (url: string) =>
      sessionAgent.delete(url).set('x-csrf-token', csrfToken).set('Origin', APP_ORIGIN),
  });

  const usernameHash = (username: string) => {
    const key = process.env.APP_ENCRYPTION_KEY?.trim();
    if (!key) {
      throw new Error('APP_ENCRYPTION_KEY is required for API integration tests.');
    }

    return createIdentifierLookupHash(key, username);
  };

  const encryptionKey = () => {
    const key = process.env.APP_ENCRYPTION_KEY?.trim();
    if (!key) {
      throw new Error('APP_ENCRYPTION_KEY is required for API integration tests.');
    }

    return key;
  };

  const decryptAtRest = (value: string) => decryptAtRestValue(encryptionKey(), value);

  const ensureUser = async (input: {
    username: string;
    password: string;
    displayName: string;
    role: 'CLERK';
    externalIdentifier: string;
  }) => {
    const passwordHash = await argon2.hash(input.password);
    const result = await pool.query<{ id: string }>(
      `
      INSERT INTO users (
        username,
        username_cipher,
        username_lookup_hash,
        display_name,
        role,
        password_hash,
        external_identifier_cipher
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (username_lookup_hash)
      DO UPDATE SET username = EXCLUDED.username,
                    username_cipher = EXCLUDED.username_cipher,
                    username_lookup_hash = EXCLUDED.username_lookup_hash,
                    display_name = EXCLUDED.display_name,
                    role = EXCLUDED.role,
                    password_hash = EXCLUDED.password_hash,
                    external_identifier_cipher = EXCLUDED.external_identifier_cipher,
                    is_suspended = FALSE,
                    failed_login_attempts = 0,
                    locked_until = NULL,
                    updated_at = NOW()
      RETURNING id
      `,
      [
        null,
        encryptAtRestValue(encryptionKey(), input.username),
        usernameHash(input.username),
        input.displayName,
        input.role,
        passwordHash,
        encryptAtRestValue(encryptionKey(), input.externalIdentifier),
      ],
    );

    return result.rows[0]!.id;
  };

  const findUserId = async (username: string) => {
    const result = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE username_lookup_hash = $1',
      [usernameHash(username)],
    );

    return result.rows[0]!.id;
  };

  const issueSessionToken = async (input: {
    userId: string;
    workspace: 'app' | 'pos' | 'mod' | 'admin' | 'finance';
    token?: string;
  }) => {
    const token = input.token ?? `session-token-${Date.now()}-${Math.random()}`;
    await pool.query(
      `
      INSERT INTO sessions (user_id, token_hash, workspace, last_activity_at, expires_at)
      VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '30 minutes')
      `,
      [input.userId, createHash('sha256').update(token).digest('hex'), input.workspace],
    );

    return token;
  };

  const spawnSeedScript = async (options?: {
    reset?: boolean;
    nodeEnv?: string;
    allowDestructiveResetInProduction?: boolean;
  }) => {
    const apiRoot = resolve(__dirname, '..');
    const adminDatabaseUrl =
      process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: adminDatabaseUrl,
      DATABASE_ADMIN_URL: adminDatabaseUrl,
      APP_ENCRYPTION_KEY: encryptionKey(),
      NODE_ENV: options?.nodeEnv ?? process.env.NODE_ENV ?? 'test',
    };

    if (options?.reset) {
      env.LEDGERREAD_SEED_RESET = '1';
    } else {
      delete env.LEDGERREAD_SEED_RESET;
    }

    if (options?.allowDestructiveResetInProduction) {
      env.LEDGERREAD_ALLOW_DESTRUCTIVE_SEED_IN_PRODUCTION = '1';
    } else {
      delete env.LEDGERREAD_ALLOW_DESTRUCTIVE_SEED_IN_PRODUCTION;
    }

    return await new Promise<{ code: number; stdout: string; stderr: string }>((resolveSeed) => {
      const child = spawn('npm', ['run', 'seed'], {
        cwd: apiRoot,
        env,
        shell: false,
      });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('exit', (code) => {
        resolveSeed({
          code: code ?? 1,
          stdout,
          stderr,
        });
      });
    });
  };

  beforeAll(async () => {
    originalAllowedOriginsEnv = process.env.APP_ALLOWED_ORIGINS;
    const allowedOrigins = new Set(
      (process.env.APP_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    );
    allowedOrigins.add(CONFIGURED_LAN_ORIGIN);
    process.env.APP_ALLOWED_ORIGINS = Array.from(allowedOrigins).join(',');

    const adminDatabaseUrl =
      process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? DEFAULT_ADMIN_DATABASE_URL;
    const appDatabaseUrl = process.env.APP_DATABASE_URL ?? deriveRuntimeDatabaseUrl(adminDatabaseUrl);

    pool = new Pool({
      connectionString: adminDatabaseUrl,
    });
    runtimePool = new Pool({
      connectionString: appDatabaseUrl,
    });
    await runtimePool.query('SELECT 1');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    agent = request(app.getHttpServer());
    await pool.query(`
      UPDATE users
      SET is_suspended = FALSE,
          failed_login_attempts = 0,
          locked_until = NULL,
          updated_at = NOW()
    `);
    await pool.query('DELETE FROM sessions');
    await pool.query('DELETE FROM moderation_actions');
    await pool.query('DELETE FROM reports');
    await pool.query('DELETE FROM user_blocks');
    await pool.query('DELETE FROM user_mutes');
    await pool.query('DELETE FROM comments');

    const quietHarbor = await pool.query<{ id: string }>(
      "SELECT id FROM titles WHERE slug = 'quiet-harbor-digital'",
    );
    const readerAda = { id: await findUserId('reader.ada') };
    const readerMei = { id: await findUserId('reader.mei') };
    const rootComment = await pool.query<{ id: string }>(
      `
      INSERT INTO comments (title_id, user_id, comment_type, body, duplicate_fingerprint)
      VALUES ($1, $2, 'COMMENT', $3, $4)
      RETURNING id
      `,
      [
        quietHarbor.rows[0]!.id,
        readerMei.id,
        'The chapter pacing feels perfect for late-night reading.',
        'seed:quiet-harbor:comment-1',
      ],
    );
    await pool.query(
      `
      INSERT INTO comments (title_id, user_id, parent_comment_id, comment_type, body, duplicate_fingerprint)
      VALUES ($1, $2, $3, 'QUESTION', $4, $5)
      `,
      [
        quietHarbor.rows[0]!.id,
        readerAda.id,
        rootComment.rows[0]!.id,
        'Does the print edition include the lantern map insert?',
        'seed:quiet-harbor:comment-2',
      ],
    );
    await ensureUser({
      username: 'clerk.oliver',
      password: 'ClerkTwo!2026',
      displayName: 'Oliver Lane',
      role: 'CLERK',
      externalIdentifier: 'EMP-CLERK-002',
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (runtimePool) {
      await runtimePool.end();
    }
    await pool.end();

    if (originalAllowedOriginsEnv === undefined) {
      delete process.env.APP_ALLOWED_ORIGINS;
    } else {
      process.env.APP_ALLOWED_ORIGINS = originalAllowedOriginsEnv;
    }
  });

  const login = async (username: string, password: string, workspace: string) => {
    const sessionAgent = request.agent(app.getHttpServer());
    const response = await sessionAgent
      .post('/auth/login')
      .set('Origin', APP_ORIGIN)
      .send({ username, password, workspace })
      .expect(201);
    const csrfToken = response.body.csrfToken as string;
    return {
      agent: createAuthenticatedAgent(sessionAgent, csrfToken),
      rawAgent: sessionAgent,
      csrfToken,
      user: response.body.user as { id: string; username: string; role: string; workspace: string },
      homePath: response.body.homePath as string,
    } satisfies {
      agent: ReturnType<typeof createAuthenticatedAgent>;
      rawAgent: ReturnType<typeof request.agent>;
      csrfToken: string;
      user: { id: string; username: string; role: string; workspace: string };
      homePath: string;
    };
  };

  const graphql = async <T = unknown>(
    sessionAgent: ReturnType<typeof createAuthenticatedAgent>,
    query: string,
    variables?: Record<string, unknown>,
  ) => {
    const response = await sessionAgent
      .post(GRAPHQL)
      .send({
        query,
        variables,
      })
      .expect(200);

    return response.body.data as T;
  };

  const graphqlResponse = async (
    sessionAgent: ReturnType<typeof createAuthenticatedAgent>,
    query: string,
    variables?: Record<string, unknown>,
  ) =>
    sessionAgent
      .post(GRAPHQL)
      .send({
        query,
        variables,
      })
      .expect(200);

  it('runs moderator and admin flows with transactional reconciliation and moving-average valuation', async () => {
    const title = await pool.query<{ id: string }>(
      "SELECT id FROM titles WHERE slug = 'quiet-harbor-digital'",
    );
    const restorableBody = `Restorable thread ${Date.now()}`;
    const suspendableBody = `Suspend target ${Date.now()}`;

    const ada = await login('reader.ada', 'Reader!2026', 'app');
    const mei = await login('reader.mei', 'Reader!2026', 'app');

    await pool.query(
      `
      UPDATE comments
      SET created_at = NOW() - INTERVAL '2 minutes'
      WHERE user_id IN ($1, $2)
      `,
      [ada.user.id, mei.user.id],
    );

    await mei.agent
      .post('/community/comments')
      .send({
        titleId: title.rows[0]!.id,
        commentType: 'COMMENT',
        body: restorableBody,
      })
      .expect(201);

    const restorableComment = await pool.query<{ id: string }>(
      'SELECT id FROM comments WHERE body = $1 ORDER BY created_at DESC LIMIT 1',
      [restorableBody],
    );

    await ada.agent
      .post('/community/reports')
      .send({
        commentId: restorableComment.rows[0]!.id,
        category: 'ABUSE',
        notes: 'restore-path coverage',
      })
      .expect(201);

    await ada.agent
      .post('/community/comments')
      .send({
        titleId: title.rows[0]!.id,
        commentType: 'COMMENT',
        body: suspendableBody,
      })
      .expect(201);

    const suspendableComment = await pool.query<{ id: string }>(
      'SELECT id FROM comments WHERE body = $1 ORDER BY created_at DESC LIMIT 1',
      [suspendableBody],
    );

    await mei.agent
      .post('/community/reports')
      .send({
        commentId: suspendableComment.rows[0]!.id,
        category: 'ABUSE',
        notes: 'suspend-path coverage',
      })
      .expect(201);

    await ada.agent.post('/auth/logout').expect(201);
    await mei.agent.post('/auth/logout').expect(201);

    const moderator = await login('mod.noah', 'Moderator!2026', 'mod');
    const openQueue = await moderator.agent.get('/moderation/queue').expect(200);
    expect(openQueue.body.length).toBeGreaterThan(0);

    const restoreCandidate = openQueue.body.find(
      (item: { comment_id: string | null }) => item.comment_id === restorableComment.rows[0]!.id,
    );
    const suspendCandidate = openQueue.body.find(
      (item: { comment_id: string | null }) => item.comment_id === suspendableComment.rows[0]!.id,
    );
    expect(restoreCandidate).toBeTruthy();
    expect(suspendCandidate).toBeTruthy();

    for (const action of ['hide', 'restore', 'remove'] as const) {
      await moderator.agent
        .post('/moderation/actions')
        .send({
          targetCommentId: restoreCandidate.comment_id,
          action,
          notes: `missing report linkage should fail for ${action}`,
        })
        .expect(409)
        .expect(({ body }) => {
          const expectedAction = action.charAt(0).toUpperCase() + action.slice(1);
          expect(body.message).toBe(`${expectedAction} requires a linked moderation report.`);
        });
    }

    await moderator.agent
      .post('/moderation/actions')
      .send({
        reportId: restoreCandidate.id,
        targetCommentId: restoreCandidate.comment_id,
        action: 'hide',
        notes: 'Reviewer moderation coverage',
      })
      .expect(201);

    const resolvedQueue = await moderator.agent
      .get('/moderation/queue?status=RESOLVED')
      .expect(200);
    const resolvedRestoreCandidate = resolvedQueue.body.find(
      (item: { comment_id: string | null }) => item.comment_id === restorableComment.rows[0]!.id,
    );
    expect(resolvedRestoreCandidate?.comment_hidden).toBe(true);

    await moderator.agent
      .post('/moderation/actions')
      .send({
        reportId: resolvedRestoreCandidate.id,
        action: 'suspend',
        notes: 'resolved report cannot suspend',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.message).toBe('Suspend requires an OPEN moderation report.');
      });

    await moderator.agent
      .post('/moderation/actions')
      .send({
        reportId: resolvedRestoreCandidate.id,
        targetCommentId: resolvedRestoreCandidate.comment_id,
        action: 'restore',
        notes: 'Reviewer restore coverage',
      })
      .expect(201);

    await moderator.agent
      .post('/moderation/actions')
      .send({
        reportId: suspendCandidate.id,
        targetCommentId: suspendCandidate.comment_id,
        targetUserId: await findUserId('reader.mei'),
        action: 'suspend',
        notes: 'override rejection coverage',
      })
      .expect(409);

    await moderator.agent
      .post('/moderation/actions')
      .send({
        targetUserId: await findUserId('manager.li'),
        action: 'suspend',
        notes: 'privileged target rejection',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.message).toBe('Suspend requires a linked moderation report.');
      });

    await moderator.agent
      .post('/moderation/actions')
      .send({
        reportId: suspendCandidate.id,
        targetCommentId: suspendCandidate.comment_id,
        action: 'suspend',
        notes: 'Reviewer suspend coverage',
      })
      .expect(201);

    const restoreActions = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM moderation_actions
      WHERE target_comment_id = $1
        AND action IN ('hide', 'restore')
      `,
      [restorableComment.rows[0]!.id],
    );
    expect(Number(restoreActions.rows[0]!.count)).toBe(2);

    await moderator.agent.post('/auth/logout').expect(201);

    await agent
      .post('/auth/login')
      .set('Origin', APP_ORIGIN)
      .send({ username: 'reader.ada', password: 'Reader!2026', workspace: 'app' })
      .expect(403);

    const restoredViewer = await login('reader.mei', 'Reader!2026', 'app');
    const restoredThread = await graphql<{
      communityThread: {
        comments: Array<{ id: string; visibleBody: string }>;
      };
    }>(
      restoredViewer.agent,
      `
        query ($titleId: String!) {
          communityThread(titleId: $titleId) {
            comments {
              id
              visibleBody
            }
          }
        }
      `,
      { titleId: title.rows[0]!.id },
    );
    expect(
      restoredThread.communityThread.comments.find(
        (comment) => comment.id === restorableComment.rows[0]!.id,
      )?.visibleBody,
    ).toBe(restorableBody);
    await restoredViewer.agent.post('/auth/logout').expect(201);

    const moderatorForRemove = await login('mod.noah', 'Moderator!2026', 'mod');
    await moderatorForRemove.agent
      .post('/moderation/actions')
      .send({
        reportId: resolvedRestoreCandidate.id,
        targetCommentId: resolvedRestoreCandidate.comment_id,
        action: 'remove',
        notes: 'Reviewer remove coverage',
      })
      .expect(201);
    await moderatorForRemove.agent.post('/auth/logout').expect(201);

    const removeActions = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM moderation_actions
      WHERE target_comment_id = $1
        AND action = 'remove'
      `,
      [restorableComment.rows[0]!.id],
    );
    expect(Number(removeActions.rows[0]!.count)).toBe(1);

    const removedComment = await pool.query<{ body: string; is_hidden: boolean }>(
      'SELECT body, is_hidden FROM comments WHERE id = $1',
      [restorableComment.rows[0]!.id],
    );
    expect(removedComment.rows[0]!.body).toBe('[removed by moderation]');
    expect(removedComment.rows[0]!.is_hidden).toBe(true);

    const admin = await login('manager.li', 'Manager!2026', 'admin');
    const valuationBefore = await pool.query<{ on_hand: number; moving_average_cost_cents: number }>(
      "SELECT on_hand, moving_average_cost_cents FROM inventory_items WHERE sku = 'SKU-QH-PRINT'",
    );

    const importResponse = await admin.agent
      .post('/admin/manifests/import')
      .send({
        supplierName: 'North Pier Press',
        sourceFilename: 'import-review.json',
        statementReference: 'STMT-2026-03-28-A',
        invoiceReference: 'INV-2026-03-28-A',
        freightCents: 800,
        surchargeCents: 200,
        paymentPlanStatus: 'DISPUTED',
        items: [
          {
            sku: 'SKU-QH-PRINT',
            statementQuantity: 10,
            invoiceQuantity: 8,
            statementExtendedAmountCents: 10000,
            invoiceExtendedAmountCents: 9600,
          },
        ],
      })
      .expect(201);
    expect(importResponse.body.discrepancyCount).toBe(1);

    const importedPlan = await pool.query<{ note_cipher: string }>(
      `
      SELECT note_cipher
      FROM payment_plans
      WHERE supplier_statement_id = $1
      LIMIT 1
      `,
      [importResponse.body.statementId],
    );
    const expectedImportedPlanNote =
      'Statement STMT-2026-03-28-A matched to invoice INV-2026-03-28-A. Freight 800 cents, surcharge 200 cents.';
    expect(importedPlan.rows[0]!.note_cipher).not.toBe(expectedImportedPlanNote);
    expect(decryptAtRest(importedPlan.rows[0]!.note_cipher)).toBe(expectedImportedPlanNote);

    const valuationAfter = await pool.query<{ on_hand: number; moving_average_cost_cents: number }>(
      "SELECT on_hand, moving_average_cost_cents FROM inventory_items WHERE sku = 'SKU-QH-PRINT'",
    );
    const expectedMovingAverage = Math.round(
      (valuationBefore.rows[0]!.on_hand * valuationBefore.rows[0]!.moving_average_cost_cents + 9600 + 1000) /
        (valuationBefore.rows[0]!.on_hand + 8),
    );
    expect(valuationAfter.rows[0]!.on_hand).toBe(valuationBefore.rows[0]!.on_hand + 8);
    expect(valuationAfter.rows[0]!.moving_average_cost_cents).toBe(expectedMovingAverage);

    const pendingSettlements = await admin.agent
      .get('/admin/settlements?status=DISPUTED')
      .expect(200);
    expect(
      pendingSettlements.body.paymentPlans.some(
        (plan: { invoice_reference: string; statement_reference: string; landedCost: number }) =>
          plan.invoice_reference === 'INV-2026-03-28-A' &&
          plan.statement_reference === 'STMT-2026-03-28-A' &&
          plan.landedCost === 10,
      ),
    ).toBe(true);
    expect(
      pendingSettlements.body.discrepancies.some(
        (item: { sku: string; quantity_difference: number; amountDifference: number }) =>
          item.sku === 'SKU-QH-PRINT' &&
          item.quantity_difference === 2 &&
          item.amountDifference === 4,
      ),
    ).toBe(true);

    const rollbackBefore = await pool.query<{ on_hand: number; moving_average_cost_cents: number }>(
      "SELECT on_hand, moving_average_cost_cents FROM inventory_items WHERE sku = 'SKU-BKMK-01'",
    );
    await admin.agent
      .post('/admin/manifests/import')
      .send({
        supplierName: 'Rollback Press',
        sourceFilename: 'rollback.json',
        statementReference: 'STMT-ROLLBACK-1',
        invoiceReference: 'INV-ROLLBACK-1',
        freightCents: 300,
        surchargeCents: 100,
        paymentPlanStatus: 'PENDING',
        items: [
          {
            sku: 'SKU-BKMK-01',
            statementQuantity: 5,
            invoiceQuantity: 5,
            statementExtendedAmountCents: 1500,
            invoiceExtendedAmountCents: 1450,
          },
          {
            sku: 'SKU-UNKNOWN',
            statementQuantity: 2,
            invoiceQuantity: 2,
            statementExtendedAmountCents: 400,
            invoiceExtendedAmountCents: 400,
          },
        ],
      })
      .expect(404);

    const rollbackStatementCount = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM supplier_statements
      WHERE statement_reference = 'STMT-ROLLBACK-1'
      `,
    );
    const rollbackInvoiceCount = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM supplier_invoices
      WHERE invoice_reference = 'INV-ROLLBACK-1'
      `,
    );
    const rollbackInventoryAfter = await pool.query<{ on_hand: number; moving_average_cost_cents: number }>(
      "SELECT on_hand, moving_average_cost_cents FROM inventory_items WHERE sku = 'SKU-BKMK-01'",
    );
    expect(Number(rollbackStatementCount.rows[0]!.count)).toBe(0);
    expect(Number(rollbackInvoiceCount.rows[0]!.count)).toBe(0);
    expect(rollbackInventoryAfter.rows[0]!.on_hand).toBe(rollbackBefore.rows[0]!.on_hand);
    expect(rollbackInventoryAfter.rows[0]!.moving_average_cost_cents).toBe(
      rollbackBefore.rows[0]!.moving_average_cost_cents,
    );

    const pagedAudit = await admin.agent
      .get('/admin/audit-logs?limit=2&action=CHECKOUT_COMPLETED')
      .expect(200);
    expect(pagedAudit.body.length).toBeLessThanOrEqual(2);
    expect(pagedAudit.body.every((item: { action: string }) => item.action === 'CHECKOUT_COMPLETED')).toBe(true);

    await admin.agent.post('/auth/logout').expect(201);
  });

  it('verifies legitimate tied-timestamp audit and attendance chain entries deterministically', async () => {
    const manager = await login('manager.li', 'Manager!2026', 'admin');
    const clerkId = await findUserId('clerk.emma');
    const tieCreatedAt = new Date().toISOString();

    const latestAudit = await pool.query<{ current_hash: string }>(
      'SELECT current_hash FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 1',
    );
    const latestAttendance = await pool.query<{ current_hash: string }>(
      'SELECT current_hash FROM attendance_records ORDER BY created_at DESC, id DESC LIMIT 1',
    );

    const [auditIdA, auditIdB] = [randomUUID(), randomUUID()].sort((left, right) =>
      left.localeCompare(right),
    );
    const auditPayloadA = {
      traceId: `tie-audit-${Date.now()}-a`,
      actorUserId: manager.user.id,
      action: 'TIE_SAFE_AUDIT_A',
      entityType: 'audit_log',
      entityId: `tie-a-${Date.now()}`,
      payload: { tie: 'A' },
      createdAt: tieCreatedAt,
    };
    const auditHashA = chainHash(auditPayloadA, latestAudit.rows[0]?.current_hash ?? null);
    const auditSignatureA = chainSignature(
      'audit',
      auditPayloadA,
      latestAudit.rows[0]?.current_hash ?? null,
      auditHashA,
    );
    const auditPayloadB = {
      traceId: `tie-audit-${Date.now()}-b`,
      actorUserId: manager.user.id,
      action: 'TIE_SAFE_AUDIT_B',
      entityType: 'audit_log',
      entityId: `tie-b-${Date.now()}`,
      payload: { tie: 'B' },
      createdAt: tieCreatedAt,
    };
    const auditHashB = chainHash(auditPayloadB, auditHashA);
    const auditSignatureB = chainSignature('audit', auditPayloadB, auditHashA, auditHashB);

    await pool.query(
      `
      INSERT INTO audit_logs (
        id,
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
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
      `,
      [
        auditIdB,
        auditPayloadB.traceId,
        auditPayloadB.actorUserId,
        auditPayloadB.action,
        auditPayloadB.entityType,
        auditPayloadB.entityId,
        JSON.stringify(auditPayloadB.payload),
        auditHashA,
        auditHashB,
        auditSignatureB,
        tieCreatedAt,
      ],
    );
    await pool.query(
      `
      INSERT INTO audit_logs (
        id,
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
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
      `,
      [
        auditIdA,
        auditPayloadA.traceId,
        auditPayloadA.actorUserId,
        auditPayloadA.action,
        auditPayloadA.entityType,
        auditPayloadA.entityId,
        JSON.stringify(auditPayloadA.payload),
        latestAudit.rows[0]?.current_hash ?? null,
        auditHashA,
        auditSignatureA,
        tieCreatedAt,
      ],
    );

    const [attendanceIdA, attendanceIdB] = [randomUUID(), randomUUID()].sort((left, right) =>
      left.localeCompare(right),
    );
    const attendancePayloadA = {
      userId: clerkId,
      eventType: 'CLOCK_IN',
      occurredAt: tieCreatedAt,
      evidenceChecksum: null,
    };
    const attendanceHashA = chainHash(attendancePayloadA, latestAttendance.rows[0]?.current_hash ?? null);
    const attendanceSignatureA = chainSignature(
      'attendance',
      attendancePayloadA,
      latestAttendance.rows[0]?.current_hash ?? null,
      attendanceHashA,
    );
    const attendancePayloadB = {
      userId: clerkId,
      eventType: 'CLOCK_OUT',
      occurredAt: tieCreatedAt,
      evidenceChecksum: null,
    };
    const attendanceHashB = chainHash(attendancePayloadB, attendanceHashA);
    const attendanceSignatureB = chainSignature(
      'attendance',
      attendancePayloadB,
      attendanceHashA,
      attendanceHashB,
    );

    await pool.query(
      `
      INSERT INTO attendance_records (
        id,
        user_id,
        event_type,
        occurred_at,
        evidence_path,
        evidence_mime_type,
        evidence_checksum,
        previous_hash,
        current_hash,
        chain_signature,
        created_at
      )
      VALUES ($1, $2, $3, $4, NULL, NULL, NULL, $5, $6, $7, $8)
      `,
      [
        attendanceIdB,
        clerkId,
        'CLOCK_OUT',
        tieCreatedAt,
        attendanceHashA,
        attendanceHashB,
        attendanceSignatureB,
        tieCreatedAt,
      ],
    );
    await pool.query(
      `
      INSERT INTO attendance_records (
        id,
        user_id,
        event_type,
        occurred_at,
        evidence_path,
        evidence_mime_type,
        evidence_checksum,
        previous_hash,
        current_hash,
        chain_signature,
        created_at
      )
      VALUES ($1, $2, $3, $4, NULL, NULL, NULL, $5, $6, $7, $8)
      `,
      [
        attendanceIdA,
        clerkId,
        'CLOCK_IN',
        tieCreatedAt,
        latestAttendance.rows[0]?.current_hash ?? null,
        attendanceHashA,
        attendanceSignatureA,
        tieCreatedAt,
      ],
    );

    const integrity = await manager.agent.get('/admin/audit-integrity').expect(200);
    expect(integrity.body.auditLogs.valid).toBe(true);
    expect(integrity.body.attendanceRecords.valid).toBe(true);

    await manager.agent.post('/auth/logout').expect(201);
  });

  it('detects forged audit and attendance chain entries through the integrity verifier', async () => {
    const manager = await login('manager.li', 'Manager!2026', 'admin');
    const clerkId = await findUserId('clerk.emma');
    const latestAudit = await pool.query<{ current_hash: string }>(
      'SELECT current_hash FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 1',
    );
    const latestAttendance = await pool.query<{ current_hash: string }>(
      'SELECT current_hash FROM attendance_records ORDER BY created_at DESC, id DESC LIMIT 1',
    );

    await pool.query(
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
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, NOW())
      `,
      [
        `forged-audit-${Date.now()}`,
        manager.user.id,
        'FORGED_AUDIT_ENTRY',
        'audit_log',
        'forged-entry',
        JSON.stringify({ tampered: true }),
        latestAudit.rows[0]?.current_hash ?? null,
        'forged-audit-hash',
        'f'.repeat(64),
      ],
    );

    await pool.query(
      `
      INSERT INTO attendance_records (
        user_id,
        event_type,
        occurred_at,
        evidence_path,
        evidence_mime_type,
        evidence_checksum,
        previous_hash,
        current_hash,
        chain_signature,
        created_at
      )
      VALUES ($1, $2, NOW(), NULL, NULL, NULL, $3, $4, $5, NOW())
      `,
      [
        clerkId,
        'CLOCK_IN',
        latestAttendance.rows[0]?.current_hash ?? null,
        'forged-attendance-hash',
        'f'.repeat(64),
      ],
    );

    const integrity = await manager.agent.get('/admin/audit-integrity').expect(200);
    expect(integrity.body.auditLogs.valid).toBe(false);
    expect(integrity.body.attendanceRecords.valid).toBe(false);
    expect(
      integrity.body.auditLogs.issues.some((issue: { reason: string }) =>
        issue.reason.includes('current_hash does not match the stored audit payload.'),
      ),
    ).toBe(true);
    expect(
      integrity.body.attendanceRecords.issues.some((issue: { reason: string }) =>
        issue.reason.includes('current_hash does not match the stored attendance payload.'),
      ),
    ).toBe(true);

    await manager.agent.post('/auth/logout').expect(201);
  });

  it('rejects direct audit and attendance inserts that omit chain signatures', async () => {
    const manager = await login('manager.li', 'Manager!2026', 'admin');
    const clerkId = await findUserId('clerk.emma');

    await expect(
      pool.query(
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
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW())
        `,
        [
          `unsigned-audit-${Date.now()}`,
          manager.user.id,
          'UNSIGNED_AUDIT_ENTRY',
          'audit_log',
          'unsigned-entry',
          JSON.stringify({ unsigned: true }),
          null,
          '0'.repeat(64),
        ],
      ),
    ).rejects.toThrow(/requires a valid chain_signature/i);

    await expect(
      pool.query(
        `
        INSERT INTO attendance_records (
          user_id,
          event_type,
          occurred_at,
          evidence_path,
          evidence_mime_type,
          evidence_checksum,
          previous_hash,
          current_hash,
          created_at
        )
        VALUES ($1, $2, NOW(), NULL, NULL, NULL, $3, $4, NOW())
        `,
        [clerkId, 'CLOCK_IN', null, '0'.repeat(64)],
      ),
    ).rejects.toThrow(/requires a valid chain_signature/i);

    await manager.agent.post('/auth/logout').expect(201);
  });

  it('detects signed-chain tampering when payloads are rewritten with recomputed plain hashes', async () => {
    const manager = await login('manager.li', 'Manager!2026', 'admin');
    const clerkId = await findUserId('clerk.emma');
    const latestAudit = await pool.query<{ current_hash: string }>(
      'SELECT current_hash FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 1',
    );
    const latestAttendance = await pool.query<{ current_hash: string }>(
      'SELECT current_hash FROM attendance_records ORDER BY created_at DESC, id DESC LIMIT 1',
    );

    const auditCreatedAt = new Date().toISOString();
    const originalAuditPayload = {
      traceId: `signed-audit-orig-${Date.now()}`,
      actorUserId: manager.user.id,
      action: 'CHECKOUT_COMPLETED',
      entityType: 'order',
      entityId: `order-${Date.now()}`,
      payload: { paymentMethod: 'CASH', total: 1200 },
      createdAt: auditCreatedAt,
    };
    const originalAuditHash = chainHash(
      originalAuditPayload,
      latestAudit.rows[0]?.current_hash ?? null,
    );
    const originalAuditSignature = chainSignature(
      'audit',
      originalAuditPayload,
      latestAudit.rows[0]?.current_hash ?? null,
      originalAuditHash,
    );
    const tamperedAuditPayload = {
      ...originalAuditPayload,
      payload: { paymentMethod: 'CASH', total: 120000 },
    };
    const recomputedAuditHash = chainHash(
      tamperedAuditPayload,
      latestAudit.rows[0]?.current_hash ?? null,
    );

    await pool.query(
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
        tamperedAuditPayload.traceId,
        tamperedAuditPayload.actorUserId,
        tamperedAuditPayload.action,
        tamperedAuditPayload.entityType,
        tamperedAuditPayload.entityId,
        JSON.stringify(tamperedAuditPayload.payload),
        latestAudit.rows[0]?.current_hash ?? null,
        recomputedAuditHash,
        originalAuditSignature,
        auditCreatedAt,
      ],
    );

    const attendanceOccurredAt = new Date().toISOString();
    const originalAttendancePayload = {
      userId: clerkId,
      eventType: 'CLOCK_IN',
      occurredAt: attendanceOccurredAt,
      evidenceChecksum: null,
    };
    const originalAttendanceHash = chainHash(
      originalAttendancePayload,
      latestAttendance.rows[0]?.current_hash ?? null,
    );
    const originalAttendanceSignature = chainSignature(
      'attendance',
      originalAttendancePayload,
      latestAttendance.rows[0]?.current_hash ?? null,
      originalAttendanceHash,
    );
    const tamperedAttendancePayload = {
      ...originalAttendancePayload,
      eventType: 'CLOCK_OUT',
    };
    const recomputedAttendanceHash = chainHash(
      tamperedAttendancePayload,
      latestAttendance.rows[0]?.current_hash ?? null,
    );

    await pool.query(
      `
      INSERT INTO attendance_records (
        user_id,
        event_type,
        occurred_at,
        evidence_path,
        evidence_mime_type,
        evidence_checksum,
        previous_hash,
        current_hash,
        chain_signature,
        created_at
      )
      VALUES ($1, $2, $3, NULL, NULL, NULL, $4, $5, $6, $7)
      `,
      [
        clerkId,
        tamperedAttendancePayload.eventType,
        attendanceOccurredAt,
        latestAttendance.rows[0]?.current_hash ?? null,
        recomputedAttendanceHash,
        originalAttendanceSignature,
        attendanceOccurredAt,
      ],
    );

    const integrity = await manager.agent.get('/admin/audit-integrity').expect(200);
    expect(integrity.body.auditLogs.valid).toBe(false);
    expect(integrity.body.attendanceRecords.valid).toBe(false);
    expect(
      integrity.body.auditLogs.issues.some((issue: { reason: string }) =>
        issue.reason.includes('chain_signature does not match the stored audit payload.'),
      ),
    ).toBe(true);
    expect(
      integrity.body.attendanceRecords.issues.some((issue: { reason: string }) =>
        issue.reason.includes('chain_signature does not match the stored attendance payload.'),
      ),
    ).toBe(true);

    await manager.agent.post('/auth/logout').expect(201);
  });

  it(
    'preserves immutable governance history on routine startup seeding and only resets through explicit dev opt-in',
    async () => {
      const clerk = await login('clerk.emma', 'Clerk!2026', 'pos');
      const clockIn = await clerk.agent
        .post('/attendance/clock-in')
        .field('occurredAt', new Date().toISOString())
        .expect(201);

      const auditedRecord = await pool.query<{ id: string }>(
        `
        SELECT id
        FROM audit_logs
        WHERE entity_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        `,
        [clockIn.body.recordId],
      );
      expect(auditedRecord.rows[0]).toBeTruthy();

      const routineSeed = await spawnSeedScript();
      expect(routineSeed.code).toBe(0);
      expect(routineSeed.stdout).toContain('Seed skipped: database baseline is complete.');

      const retainedAttendance = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM attendance_records WHERE id = $1',
        [clockIn.body.recordId],
      );
      const retainedAudit = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM audit_logs WHERE id = $1',
        [auditedRecord.rows[0]!.id],
      );
      expect(Number(retainedAttendance.rows[0]!.count)).toBe(1);
      expect(Number(retainedAudit.rows[0]!.count)).toBe(1);

      await clerk.agent.post('/auth/logout').expect(201);

      const blockedProductionReset = await spawnSeedScript({
        reset: true,
        nodeEnv: 'production',
      });
      expect(blockedProductionReset.code).not.toBe(0);
      expect(`${blockedProductionReset.stdout}\n${blockedProductionReset.stderr}`).toContain(
        'Refusing destructive seed reset in production.',
      );

      const explicitDevReset = await spawnSeedScript({
        reset: true,
        nodeEnv: 'development',
      });
      expect(explicitDevReset.code).toBe(0);

      const removedAttendance = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM attendance_records WHERE id = $1',
        [clockIn.body.recordId],
      );
      const removedAudit = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM audit_logs WHERE id = $1',
        [auditedRecord.rows[0]!.id],
      );
      expect(Number(removedAttendance.rows[0]!.count)).toBe(0);
      expect(Number(removedAudit.rows[0]!.count)).toBe(0);
    },
    120_000,
  );

  it('removes superseded reconciliation tables from the active schema', async () => {
    const legacyTables = await pool.query<{ table_name: string }>(
      `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('supplier_manifests', 'supplier_manifest_items', 'discrepancy_flags')
      ORDER BY table_name ASC
      `,
    );

    expect(legacyTables.rows).toEqual([]);
  });
});
