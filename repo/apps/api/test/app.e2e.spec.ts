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

describe('LedgerRead API (auth-admin)', () => {
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

  it('rejects unauthenticated session access with 401', async () => {
    await agent.get('/auth/session').expect(401);
  });

  it('rejects cross-origin login attempts and preserves same-origin login behavior', async () => {
    await agent
      .post('/auth/login')
      .set('Origin', 'http://evil.example')
      .send({ username: 'reader.ada', password: 'Reader!2026', workspace: 'app' })
      .expect(403)
      .expect(({ body }) => {
        expect(body.message).toBe('Request origin is not allowed for login.');
      });

    await agent
      .post('/auth/login')
      .set('Origin', 'http://192.168.50.30:4000')
      .set('Host', 'localhost:4000')
      .set('x-forwarded-host', '192.168.50.30:4000')
      .send({ username: 'reader.ada', password: 'Reader!2026', workspace: 'app' })
      .expect(403)
      .expect(({ body }) => {
        expect(body.message).toBe('Request origin is not allowed for login.');
      });

    await agent
      .post('/auth/login')
      .send({ username: 'reader.ada', password: 'Reader!2026', workspace: 'app' })
      .expect(403)
      .expect(({ body }) => {
        expect(body.message).toBe('Request origin is required for login.');
      });

    const sameOriginSession = request.agent(app.getHttpServer());
    const sameOriginLogin = await sameOriginSession
      .post('/auth/login')
      .set('Origin', APP_ORIGIN)
      .send({ username: 'reader.ada', password: 'Reader!2026', workspace: 'app' })
      .expect(201);
    await sameOriginSession
      .post('/auth/logout')
      .set('Origin', APP_ORIGIN)
      .set('x-csrf-token', sameOriginLogin.body.csrfToken as string)
      .expect(201);
  });

  it('rejects cookie-authenticated mutations without a valid CSRF token or allowed origin', async () => {
    const clerk = await login('clerk.emma', 'Clerk!2026', 'pos');
    const occurredAt = new Date().toISOString();

    await clerk.rawAgent
      .post('/attendance/clock-in')
      .field('occurredAt', occurredAt)
      .expect(403)
      .expect(({ body }) => {
        expect(body.message).toBe('CSRF protection token is missing or invalid.');
      });

    await clerk.rawAgent
      .post('/attendance/clock-in')
      .set('x-csrf-token', 'invalid-csrf-token')
      .set('Origin', APP_ORIGIN)
      .field('occurredAt', occurredAt)
      .expect(403)
      .expect(({ body }) => {
        expect(body.message).toBe('CSRF protection token is missing or invalid.');
      });

    await clerk.rawAgent
      .post('/attendance/clock-in')
      .set('x-csrf-token', clerk.csrfToken)
      .set('Origin', 'http://evil.example')
      .field('occurredAt', occurredAt)
      .expect(403)
      .expect(({ body }) => {
        expect(body.message).toBe('Request origin is not allowed for authenticated mutations.');
      });

    await clerk.rawAgent
      .post('/attendance/clock-in')
      .set('x-csrf-token', clerk.csrfToken)
      .set('Origin', CONFIGURED_LAN_ORIGIN)
      .field('occurredAt', new Date().toISOString())
      .expect(201);

    await clerk.rawAgent
      .post('/attendance/clock-in')
      .set('x-csrf-token', clerk.csrfToken)
      .set('Origin', 'http://192.168.50.30:4000')
      .set('Host', '192.168.50.30:4000')
      .field('occurredAt', new Date().toISOString())
      .expect(201);

    await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', occurredAt)
      .expect(201);

    await clerk.agent.post('/auth/logout').expect(201);
  });

  it('enforces a server-side attendance timestamp skew window for client-provided occurredAt values', async () => {
    const clerk = await login('clerk.emma', 'Clerk!2026', 'pos');
    const tooOld = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const tooFuture = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', tooOld)
      .expect(400)
      .expect(({ body }) => {
        expect(String(body.message)).toContain('within');
      });

    await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', tooFuture)
      .expect(400)
      .expect(({ body }) => {
        expect(String(body.message)).toContain('within');
      });

    await clerk.agent.post('/auth/logout').expect(201);
  });

  it('chains server-authoritative attendance time while retaining client time as metadata', async () => {
    const clerk = await login('clerk.emma', 'Clerk!2026', 'pos');
    const clientOccurredAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const clockIn = await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', clientOccurredAt)
      .expect(201);

    const persisted = await pool.query<{
      id: string;
      user_id: string;
      event_type: 'CLOCK_IN' | 'CLOCK_OUT';
      occurred_at: string;
      client_occurred_at: string | null;
      evidence_checksum: string | null;
      previous_hash: string | null;
      current_hash: string;
    }>(
      `
      SELECT id,
             user_id,
             event_type,
             occurred_at,
             client_occurred_at,
             evidence_checksum,
             previous_hash,
             current_hash
      FROM attendance_records
      WHERE id = $1
      `,
      [clockIn.body.recordId],
    );
    const row = persisted.rows[0]!;

    expect(row.client_occurred_at).not.toBeNull();
    expect(Math.abs(new Date(row.client_occurred_at!).getTime() - new Date(clientOccurredAt).getTime())).toBeLessThan(
      2_000,
    );
    expect(Math.abs(new Date(row.occurred_at).getTime() - Date.now())).toBeLessThan(20_000);
    expect(Math.abs(new Date(row.occurred_at).getTime() - new Date(clientOccurredAt).getTime())).toBeGreaterThan(
      30_000,
    );

    const authoritativePayload = {
      userId: row.user_id,
      eventType: row.event_type,
      occurredAt: new Date(row.occurred_at).toISOString(),
      clientOccurredAt: new Date(row.client_occurred_at!).toISOString(),
      evidenceChecksum: row.evidence_checksum,
    };
    expect(row.current_hash).toBe(chainHash(authoritativePayload, row.previous_hash));

    const clientControlledPayload = {
      userId: row.user_id,
      eventType: row.event_type,
      occurredAt: new Date(row.client_occurred_at!).toISOString(),
      evidenceChecksum: row.evidence_checksum,
    };
    expect(row.current_hash).not.toBe(chainHash(clientControlledPayload, row.previous_hash));

    await clerk.agent
      .post('/attendance/clock-out')
      .field('occurredAt', new Date().toISOString())
      .expect(201);
    await clerk.agent.post('/auth/logout').expect(201);
  });

  it('uses authoritative attendance timestamps (not client metadata) for overdue risk evaluation', async () => {
    const clerk = await login('clerk.emma', 'Clerk!2026', 'pos');
    const latestAttendance = await pool.query<{ current_hash: string }>(
      'SELECT current_hash FROM attendance_records ORDER BY created_at DESC, id DESC LIMIT 1',
    );

    const authoritativeOccurredAt = new Date().toISOString();
    const clientOccurredAt = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    const payload = {
      userId: clerk.user.id,
      eventType: 'CLOCK_IN',
      occurredAt: authoritativeOccurredAt,
      clientOccurredAt,
      evidenceChecksum: null,
    };
    const currentHash = chainHash(payload, latestAttendance.rows[0]?.current_hash ?? null);
    const signature = chainSignature(
      'attendance',
      payload,
      latestAttendance.rows[0]?.current_hash ?? null,
      currentHash,
    );

    const inserted = await pool.query<{ id: string }>(
      `
      INSERT INTO attendance_records (
        user_id,
        event_type,
        occurred_at,
        client_occurred_at,
        evidence_path,
        evidence_mime_type,
        evidence_checksum,
        previous_hash,
        current_hash,
        chain_signature,
        created_at
      )
      VALUES ($1, $2, $3, $4, NULL, NULL, NULL, $5, $6, $7, NOW())
      RETURNING id
      `,
      [
        clerk.user.id,
        'CLOCK_IN',
        authoritativeOccurredAt,
        clientOccurredAt,
        latestAttendance.rows[0]?.current_hash ?? null,
        currentHash,
        signature,
      ],
    );

    await clerk.agent.get('/attendance/risks').expect(200);

    const relatedRisk = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM risk_alerts
      WHERE attendance_record_id = $1
        AND description = 'Missing clock-out after 12 hours.'
      `,
      [inserted.rows[0]!.id],
    );
    expect(Number(relatedRisk.rows[0]!.count)).toBe(0);

    await clerk.agent.post('/auth/logout').expect(201);
  });

  it('refreshes overdue attendance risks globally for manager views without waiting for cron', async () => {
    const globalRiskClerkUsername = `clerk.global.${Date.now()}`;
    const globalRiskClerkId = await ensureUser({
      username: globalRiskClerkUsername,
      password: 'GlobalRisk!2026',
      displayName: 'Global Risk Clerk',
      role: 'CLERK',
      externalIdentifier: `EID-${Date.now()}`,
    });
    const manager = await login('manager.li', 'Manager!2026', 'admin');
    const latestAttendance = await pool.query<{ current_hash: string }>(
      'SELECT current_hash FROM attendance_records ORDER BY created_at DESC, id DESC LIMIT 1',
    );

    const overdueOccurredAt = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    const payload = {
      userId: globalRiskClerkId,
      eventType: 'CLOCK_IN',
      occurredAt: overdueOccurredAt,
      evidenceChecksum: null,
    };
    const currentHash = chainHash(payload, latestAttendance.rows[0]?.current_hash ?? null);
    const signature = chainSignature(
      'attendance',
      payload,
      latestAttendance.rows[0]?.current_hash ?? null,
      currentHash,
    );

    const inserted = await pool.query<{ id: string }>(
      `
      INSERT INTO attendance_records (
        user_id,
        event_type,
        occurred_at,
        client_occurred_at,
        evidence_path,
        evidence_mime_type,
        evidence_checksum,
        previous_hash,
        current_hash,
        chain_signature,
        created_at
      )
      VALUES ($1, $2, $3, $4, NULL, NULL, NULL, $5, $6, $7, NOW())
      RETURNING id
      `,
      [
        globalRiskClerkId,
        'CLOCK_IN',
        overdueOccurredAt,
        overdueOccurredAt,
        latestAttendance.rows[0]?.current_hash ?? null,
        currentHash,
        signature,
      ],
    );

    await manager.agent.get('/attendance/risks').expect(200);

    const relatedRisk = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM risk_alerts
      WHERE attendance_record_id = $1
        AND description = 'Missing clock-out after 12 hours.'
      `,
      [inserted.rows[0]!.id],
    );
    expect(Number(relatedRisk.rows[0]!.count)).toBe(1);

    await manager.agent.post('/auth/logout').expect(201);
  });

  it('enforces least-privilege role boundaries for attendance write and risk endpoints', async () => {
    const clerk = await login('clerk.emma', 'Clerk!2026', 'pos');
    const moderator = await login('mod.noah', 'Moderator!2026', 'mod');
    const manager = await login('manager.li', 'Manager!2026', 'admin');
    const finance = await login('finance.zoe', 'Finance!2026', 'finance');
    const inventory = await login('inventory.ivan', 'Inventory!2026', 'admin');
    const customer = await login('reader.ada', 'Reader!2026', 'app');

    await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .expect(201);
    await clerk.agent
      .post('/attendance/clock-out')
      .field('occurredAt', new Date().toISOString())
      .expect(201);

    await moderator.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .expect(403);
    await manager.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .expect(403);
    await finance.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .expect(403);
    await inventory.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .expect(403);
    await customer.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .expect(403);

    await clerk.agent.get('/attendance/risks').expect(200);
    await manager.agent.get('/attendance/risks').expect(200);
    await finance.agent.get('/attendance/risks').expect(200);
    await inventory.agent.get('/attendance/risks').expect(200);
    await moderator.agent.get('/attendance/risks').expect(403);
    await customer.agent.get('/attendance/risks').expect(403);

    await clerk.agent.post('/auth/logout').expect(201);
    await moderator.agent.post('/auth/logout').expect(201);
    await manager.agent.post('/auth/logout').expect(201);
    await finance.agent.post('/auth/logout').expect(201);
    await inventory.agent.post('/auth/logout').expect(201);
    await customer.agent.post('/auth/logout').expect(201);
  });

  it('rejects bearer-only authentication on browser-facing routes', async () => {
    const clerkUserId = await findUserId('clerk.emma');
    const bearerToken = await issueSessionToken({
      userId: clerkUserId,
      workspace: 'pos',
    });

    await agent
      .get('/auth/session')
      .set('Authorization', `Bearer ${bearerToken}`)
      .expect(401)
      .expect(({ body }) => {
        expect(body.message).toBe('Authentication is required.');
      });

    await agent
      .post('/attendance/clock-in')
      .set('Authorization', `Bearer ${bearerToken}`)
      .set('Origin', APP_ORIGIN)
      .field('occurredAt', new Date().toISOString())
      .expect(401)
      .expect(({ body }) => {
        expect(body.message).toBe('Authentication is required.');
      });
  });

  it('treats malformed session cookie values as unauthenticated input', async () => {
    const malformedCookie = 'ledgerread_session=%E0%A4%A';

    await agent.get('/auth/session').set('Cookie', malformedCookie).expect(401);
    await agent
      .post('/attendance/clock-in')
      .set('Cookie', malformedCookie)
      .field('occurredAt', new Date().toISOString())
      .expect(401);
  });

  it('restricts /profiles endpoints to customers and returns 403 for other roles', async () => {
    const validProfilePayload = {
      deviceLabel: 'Role Guard Check',
      preferences: {
        fontFamily: 'Merriweather',
        fontSize: 18,
        lineSpacing: 1.5,
        readerMode: 'PAGINATION',
        theme: 'paper',
        nightMode: false,
        chineseMode: 'SIMPLIFIED',
        updatedAt: new Date().toISOString(),
      },
    };

    const nonCustomerSessions = [
      await login('clerk.emma', 'Clerk!2026', 'pos'),
      await login('mod.noah', 'Moderator!2026', 'mod'),
      await login('manager.li', 'Manager!2026', 'admin'),
      await login('finance.zoe', 'Finance!2026', 'finance'),
      await login('inventory.ivan', 'Inventory!2026', 'admin'),
    ];

    for (const session of nonCustomerSessions) {
      await session.agent.get('/profiles/me').expect(403);
      await session.agent.put('/profiles/me').send(validProfilePayload).expect(403);
      await session.agent
        .post('/profiles/me/sync')
        .send({
          ...validProfilePayload,
          strict: true,
        })
        .expect(403);
      await session.agent.post('/auth/logout').expect(201);
    }
  });

  it('enforces auth lockout and idle session expiry', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await agent
        .post('/auth/login')
        .set('Origin', APP_ORIGIN)
        .send({ username: 'inventory.ivan', password: 'Wrong!Password1', workspace: 'admin' })
        .expect(401);
    }

    await agent
      .post('/auth/login')
      .set('Origin', APP_ORIGIN)
      .send({ username: 'inventory.ivan', password: 'Inventory!2026', workspace: 'admin' })
      .expect(401);

    const inventoryUserId = await findUserId('inventory.ivan');
    await pool.query(
      `
      UPDATE users
      SET failed_login_attempts = 5,
          locked_until = NOW() - INTERVAL '1 minute'
      WHERE id = $1
      `,
      [inventoryUserId],
    );

    await agent
      .post('/auth/login')
      .set('Origin', APP_ORIGIN)
      .send({ username: 'inventory.ivan', password: 'Wrong!Password1', workspace: 'admin' })
      .expect(401);

    const postExpiryLockoutState = await pool.query<{
      failed_login_attempts: number;
      locked_until: string | null;
    }>(
      `
      SELECT failed_login_attempts, locked_until
      FROM users
      WHERE id = $1
      `,
      [inventoryUserId],
    );
    expect(postExpiryLockoutState.rows[0]!.failed_login_attempts).toBe(1);
    expect(postExpiryLockoutState.rows[0]!.locked_until).toBeNull();

    const finance = await login('finance.zoe', 'Finance!2026', 'finance');
    await pool.query(
      `
      UPDATE sessions
      SET last_activity_at = NOW() - INTERVAL '31 minutes',
          expires_at = NOW() - INTERVAL '1 minute'
      WHERE user_id = $1
      `,
      [finance.user.id],
    );

    await finance.agent.get('/auth/session').expect(401);
    await agent.get('/auth/session').expect(401);
  });

  it('counts parallel failed logins atomically and still locks accounts at the threshold', async () => {
    const inventoryUserId = await findUserId('inventory.ivan');
    await pool.query(
      `
      UPDATE users
      SET failed_login_attempts = 0,
          locked_until = NULL,
          updated_at = NOW()
      WHERE id = $1
      `,
      [inventoryUserId],
    );

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        agent
          .post('/auth/login')
          .set('Origin', APP_ORIGIN)
          .send({ username: 'inventory.ivan', password: 'Wrong!Password1', workspace: 'admin' }),
      ),
    );
    expect(attempts.every((response) => response.status === 401)).toBe(true);

    const lockoutState = await pool.query<{
      failed_login_attempts: number;
      locked_until: string | null;
    }>(
      `
      SELECT failed_login_attempts, locked_until
      FROM users
      WHERE id = $1
      `,
      [inventoryUserId],
    );

    expect(lockoutState.rows[0]!.failed_login_attempts).toBeGreaterThanOrEqual(5);
    expect(lockoutState.rows[0]!.locked_until).not.toBeNull();
    expect(new Date(lockoutState.rows[0]!.locked_until ?? 0).getTime()).toBeGreaterThan(Date.now());

    await agent
      .post('/auth/login')
      .set('Origin', APP_ORIGIN)
      .send({ username: 'inventory.ivan', password: 'Inventory!2026', workspace: 'admin' })
      .expect(401);
  });

  it('counts mixed malformed and incorrect password attempts toward lockout consistently', async () => {
    const inventoryUserId = await findUserId('inventory.ivan');
    await pool.query(
      `
      UPDATE users
      SET failed_login_attempts = 0,
          locked_until = NULL,
          updated_at = NOW()
      WHERE id = $1
      `,
      [inventoryUserId],
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await agent
        .post('/auth/login')
        .set('Origin', APP_ORIGIN)
        .send({ username: 'inventory.ivan', password: 'short', workspace: 'admin' })
        .expect(401);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await agent
        .post('/auth/login')
        .set('Origin', APP_ORIGIN)
        .send({ username: 'inventory.ivan', password: 'Wrong!Password1', workspace: 'admin' })
        .expect(401);
    }

    await agent
      .post('/auth/login')
      .set('Origin', APP_ORIGIN)
      .send({ username: 'inventory.ivan', password: 'Inventory!2026', workspace: 'admin' })
      .expect(401);

    const lockoutState = await pool.query<{
      failed_login_attempts: number;
      locked_until: string | null;
    }>(
      `
      SELECT failed_login_attempts, locked_until
      FROM users
      WHERE id = $1
      `,
      [inventoryUserId],
    );
    expect(lockoutState.rows[0]!.failed_login_attempts).toBeGreaterThanOrEqual(5);
    expect(lockoutState.rows[0]!.locked_until).not.toBeNull();
  });

  it('allows finance read access while denying admin reconciliation mutations', async () => {
    const finance = await login('finance.zoe', 'Finance!2026', 'finance');

    await finance.agent.get('/admin/settlements').expect(200);
    await finance.agent.get('/admin/audit-logs?limit=1').expect(200);
    await finance.agent
      .post('/admin/manifests/import')
      .send({
        supplierName: 'Finance Denial Press',
        sourceFilename: 'finance-should-not-import.json',
        statementReference: 'STMT-FIN-1',
        invoiceReference: 'INV-FIN-1',
        freightCents: 100,
        surchargeCents: 0,
        paymentPlanStatus: 'PENDING',
        items: [
          {
            sku: 'SKU-BKMK-01',
            statementQuantity: 1,
            invoiceQuantity: 1,
            statementExtendedAmountCents: 300,
            invoiceExtendedAmountCents: 300,
          },
        ],
      })
      .expect(403);

    await finance.agent.post('/auth/logout').expect(201);

    const inventoryUserId = await findUserId('inventory.ivan');
    await pool.query(
      `
      UPDATE users
      SET is_suspended = FALSE,
          failed_login_attempts = 0,
          locked_until = NULL,
          updated_at = NOW()
      WHERE id = $1
      `,
      [inventoryUserId],
    );

    const inventory = await login('inventory.ivan', 'Inventory!2026', 'admin');
    await inventory.agent
      .post('/admin/manifests/import')
      .send({
        supplierName: 'Inventory Intake Press',
        sourceFilename: 'inventory-can-import.json',
        statementReference: 'STMT-INV-ALLOWED-1',
        invoiceReference: 'INV-INV-ALLOWED-1',
        freightCents: 50,
        surchargeCents: 25,
        paymentPlanStatus: 'MATCHED',
        items: [
          {
            sku: 'SKU-BKMK-01',
            statementQuantity: 1,
            invoiceQuantity: 1,
            statementExtendedAmountCents: 300,
            invoiceExtendedAmountCents: 300,
          },
        ],
      })
      .expect(201);
    await inventory.agent.post('/auth/logout').expect(201);

    const manager = await login('manager.li', 'Manager!2026', 'admin');
    await manager.agent
      .post('/admin/manifests/import')
      .send({
        supplierName: 'Manager Intake Press',
        sourceFilename: 'manager-can-import.json',
        statementReference: 'STMT-MGR-ALLOWED-1',
        invoiceReference: 'INV-MGR-ALLOWED-1',
        freightCents: 50,
        surchargeCents: 25,
        paymentPlanStatus: 'MATCHED',
        items: [
          {
            sku: 'SKU-BKMK-01',
            statementQuantity: 1,
            invoiceQuantity: 1,
            statementExtendedAmountCents: 300,
            invoiceExtendedAmountCents: 300,
          },
        ],
      })
      .expect(201);
    await manager.agent.post('/auth/logout').expect(201);
  });

  it('supports audited reconciliation status transitions with explicit role boundaries', async () => {
    const suffix = Date.now();
    const manager = await login('manager.li', 'Manager!2026', 'admin');
    const importResponse = await manager.agent
      .post('/admin/manifests/import')
      .send({
        supplierName: 'Workflow Test Press',
        sourceFilename: `workflow-${suffix}.json`,
        statementReference: `STMT-WORKFLOW-${suffix}`,
        invoiceReference: `INV-WORKFLOW-${suffix}`,
        freightCents: 100,
        surchargeCents: 50,
        paymentPlanStatus: 'DISPUTED',
        items: [
          {
            sku: 'SKU-QH-PRINT',
            statementQuantity: 12,
            invoiceQuantity: 9,
            statementExtendedAmountCents: 12000,
            invoiceExtendedAmountCents: 10800,
          },
        ],
      })
      .expect(201);
    expect(importResponse.body.discrepancyCount).toBe(1);

    const paymentPlan = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM payment_plans
      WHERE supplier_statement_id = $1
      LIMIT 1
      `,
      [importResponse.body.statementId],
    );
    const discrepancy = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM reconciliation_discrepancies
      WHERE supplier_statement_id = $1
      LIMIT 1
      `,
      [importResponse.body.statementId],
    );

    const settlements = await manager.agent.get('/admin/settlements?status=DISPUTED').expect(200);
    const importedPlan = settlements.body.paymentPlans.find((plan: { id: string }) => plan.id === paymentPlan.rows[0]!.id);
    const importedDiscrepancy = settlements.body.discrepancies.find(
      (item: { id: string }) => item.id === discrepancy.rows[0]!.id,
    );
    expect(importedPlan.allowedTransitions).toEqual(expect.arrayContaining(['MATCHED', 'PARTIAL', 'PENDING']));
    expect(importedDiscrepancy.allowedTransitions).toEqual(
      expect.arrayContaining(['UNDER_REVIEW', 'RESOLVED', 'WAIVED']),
    );
    await manager.agent.post('/auth/logout').expect(201);

    const inventory = await login('inventory.ivan', 'Inventory!2026', 'admin');
    await inventory.agent
      .patch(`/admin/payment-plans/${paymentPlan.rows[0]!.id}/status`)
      .send({ status: 'MATCHED' })
      .expect(403);

    await inventory.agent
      .patch(`/admin/discrepancies/${discrepancy.rows[0]!.id}/status`)
      .send({ status: 'UNDER_REVIEW' })
      .expect(200);
    await inventory.agent.post('/auth/logout').expect(201);

    const finance = await login('finance.zoe', 'Finance!2026', 'finance');
    await finance.agent
      .patch(`/admin/discrepancies/${discrepancy.rows[0]!.id}/status`)
      .send({ status: 'RESOLVED' })
      .expect(403);

    await finance.agent
      .patch(`/admin/payment-plans/${paymentPlan.rows[0]!.id}/status`)
      .send({ status: 'MATCHED' })
      .expect(200);

    await finance.agent
      .patch(`/admin/payment-plans/${paymentPlan.rows[0]!.id}/status`)
      .send({ status: 'PENDING' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.message).toBe('Payment plan status cannot transition from MATCHED to PENDING.');
      });
    await finance.agent.post('/auth/logout').expect(201);

    const updatedPlan = await pool.query<{ status: string }>(
      'SELECT status FROM payment_plans WHERE id = $1',
      [paymentPlan.rows[0]!.id],
    );
    const updatedDiscrepancy = await pool.query<{ status: string }>(
      'SELECT status FROM reconciliation_discrepancies WHERE id = $1',
      [discrepancy.rows[0]!.id],
    );
    expect(updatedPlan.rows[0]!.status).toBe('MATCHED');
    expect(updatedDiscrepancy.rows[0]!.status).toBe('UNDER_REVIEW');

    const auditActions = await pool.query<{ action: string }>(
      `
      SELECT action
      FROM audit_logs
      WHERE entity_id IN ($1, $2)
        AND action IN ('PAYMENT_PLAN_STATUS_UPDATED', 'RECONCILIATION_DISCREPANCY_STATUS_UPDATED')
      ORDER BY created_at ASC
      `,
      [paymentPlan.rows[0]!.id, discrepancy.rows[0]!.id],
    );
    expect(auditActions.rows.map((row) => row.action)).toEqual([
      'RECONCILIATION_DISCREPANCY_STATUS_UPDATED',
      'PAYMENT_PLAN_STATUS_UPDATED',
    ]);
  });

  it('rejects malformed privileged admin params and invalid audit-log limits at the controller boundary', async () => {
    const manager = await login('manager.li', 'Manager!2026', 'admin');

    await manager.agent
      .patch('/admin/payment-plans/not-a-uuid/status')
      .send({ status: 'MATCHED' })
      .expect(400)
      .expect(({ body }) => {
        expect(String(body.message)).toContain('uuid');
      });

    await manager.agent
      .patch('/admin/discrepancies/not-a-uuid/status')
      .send({ status: 'UNDER_REVIEW' })
      .expect(400)
      .expect(({ body }) => {
        expect(String(body.message)).toContain('uuid');
      });

    await manager.agent
      .get('/admin/audit-logs?limit=abc')
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toEqual(expect.arrayContaining(['limit must be an integer number']));
      });

    await manager.agent
      .get('/admin/audit-logs?limit=-1')
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toEqual(expect.arrayContaining(['limit must not be less than 1']));
      });

    await manager.agent
      .get('/admin/audit-logs?limit=0')
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toEqual(expect.arrayContaining(['limit must not be less than 1']));
      });

    await manager.agent
      .get(`/admin/audit-logs?limit=${MAX_AUDIT_LOG_LIMIT + 1}`)
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toEqual(
          expect.arrayContaining([`limit must not be greater than ${MAX_AUDIT_LOG_LIMIT}`]),
        );
      });

    await manager.agent
      .patch('/admin/payment-plans/00000000-0000-4000-8000-000000000901/status')
      .send({ status: 'MATCHED' })
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe('Payment plan not found.');
      });

    await manager.agent
      .patch('/admin/discrepancies/00000000-0000-4000-8000-000000000902/status')
      .send({ status: 'UNDER_REVIEW' })
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe('Reconciliation discrepancy not found.');
      });

    await manager.agent
      .get('/admin/audit-logs?limit=1')
      .expect(200);

    await manager.agent.post('/auth/logout').expect(201);
  });

  it('enforces server-side audit-log minimization with role-aware payload projection', async () => {
    const manager = await login('manager.li', 'Manager!2026', 'admin');
    const finance = await login('finance.zoe', 'Finance!2026', 'finance');
    const action = `AUDIT_VISIBILITY_TEST_${Date.now()}`;
    const latestAudit = await pool.query<{ current_hash: string }>(
      'SELECT current_hash FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 1',
    );
    const createdAt = new Date().toISOString();
    const auditPayload = {
      commentType: 'QUESTION',
      status: 'UNDER_REVIEW',
      total: 1200,
      body: 'should-not-leak',
      hashProbe: 'should-not-leak',
    };
    const chainPayload = {
      traceId: `trace-${action}`,
      actorUserId: manager.user.id,
      action,
      entityType: 'audit_visibility',
      entityId: `audit-row-${Date.now()}`,
      payload: auditPayload,
      createdAt,
    };
    const currentHash = chainHash(chainPayload, latestAudit.rows[0]?.current_hash ?? null);
    const signature = chainSignature(
      'audit',
      chainPayload,
      latestAudit.rows[0]?.current_hash ?? null,
      currentHash,
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
        chainPayload.traceId,
        chainPayload.actorUserId,
        chainPayload.action,
        chainPayload.entityType,
        chainPayload.entityId,
        JSON.stringify(chainPayload.payload),
        latestAudit.rows[0]?.current_hash ?? null,
        currentHash,
        signature,
        createdAt,
      ],
    );

    const managerAudit = await manager.agent
      .get(`/admin/audit-logs?limit=1&action=${encodeURIComponent(action)}`)
      .expect(200);
    const managerRow = managerAudit.body[0] as Record<string, unknown>;
    expect(managerRow.previous_hash).toBeUndefined();
    expect(managerRow.current_hash).toBeUndefined();
    expect((managerRow.payload as Record<string, unknown>).commentType).toBe('QUESTION');
    expect((managerRow.payload as Record<string, unknown>).total).toBe(1200);
    expect((managerRow.payload as Record<string, unknown>).body).toBeUndefined();
    expect(Number(managerRow.redacted_fields)).toBeGreaterThanOrEqual(1);

    const financeAudit = await finance.agent
      .get(`/admin/audit-logs?limit=1&action=${encodeURIComponent(action)}`)
      .expect(200);
    const financeRow = financeAudit.body[0] as Record<string, unknown>;
    expect(financeRow.previous_hash).toBeUndefined();
    expect(financeRow.current_hash).toBeUndefined();
    expect((financeRow.payload as Record<string, unknown>).total).toBe(1200);
    expect((financeRow.payload as Record<string, unknown>).commentType).toBeUndefined();
    expect((financeRow.payload as Record<string, unknown>).body).toBeUndefined();
    expect(Number(financeRow.redacted_fields)).toBeGreaterThanOrEqual(1);

    await manager.agent.post('/auth/logout').expect(201);
    await finance.agent.post('/auth/logout').expect(201);
  });

  it('rejects malformed GraphQL customer UUID args at the resolver boundary', async () => {
    const customer = await login('reader.ada', 'Reader!2026', 'app');

    const malformedTitle = await graphqlResponse(
      customer.agent,
      'query ($id: String!) { title(id: $id) { id name } }',
      { id: 'not-a-uuid' },
    );
    expect(malformedTitle.body.data).toBeNull();
    expect(malformedTitle.body.errors?.[0]?.message).toContain('uuid');
    expect(malformedTitle.body.errors?.[0]?.extensions?.originalError?.statusCode).toBe(400);

    const malformedThread = await graphqlResponse(
      customer.agent,
      `
        query ($titleId: String!) {
          communityThread(titleId: $titleId) {
            titleId
            comments {
              id
            }
          }
        }
      `,
      { titleId: 'not-a-uuid' },
    );
    expect(malformedThread.body.data).toBeNull();
    expect(malformedThread.body.errors?.[0]?.message).toContain('uuid');
    expect(malformedThread.body.errors?.[0]?.extensions?.originalError?.statusCode).toBe(400);

    const malformedRecommendations = await graphqlResponse(
      customer.agent,
      'query ($titleId: String!) { recommendations(titleId: $titleId) { titleId reason recommendedTitleIds traceId } }',
      { titleId: 'not-a-uuid' },
    );
    expect(malformedRecommendations.body.data).toBeNull();
    expect(malformedRecommendations.body.errors?.[0]?.message).toContain('uuid');
    expect(malformedRecommendations.body.errors?.[0]?.extensions?.originalError?.statusCode).toBe(400);

    const missingTitle = await graphqlResponse(
      customer.agent,
      'query ($id: String!) { title(id: $id) { id name } }',
      { id: '00000000-0000-4000-8000-000000000777' },
    );
    expect(missingTitle.body.data).toBeNull();
    expect(missingTitle.body.errors?.[0]?.message).toBe('Title not found.');
    expect(missingTitle.body.errors?.[0]?.extensions?.originalError?.statusCode).toBe(404);

    const missingThread = await graphqlResponse(
      customer.agent,
      `
        query ($titleId: String!) {
          communityThread(titleId: $titleId) {
            titleId
            comments {
              id
            }
          }
        }
      `,
      { titleId: '00000000-0000-4000-8000-000000000778' },
    );
    expect(missingThread.body.data).toBeNull();
    expect(missingThread.body.errors?.[0]?.message).toBe('Title not found.');
    expect(missingThread.body.errors?.[0]?.extensions?.originalError?.statusCode).toBe(404);

    await customer.agent.post('/auth/logout').expect(201);
  });

  it('rejects malformed identifiers and invalid admin intake payloads with 400 responses', async () => {
    const customer = await login('reader.ada', 'Reader!2026', 'app');
    const customerProfile = await customer.agent.get('/profiles/me').expect(200);

    await customer.agent
      .post('/community/comments')
      .send({
        titleId: 'not-a-uuid',
        commentType: 'COMMENT',
        body: 'Validation should reject malformed title IDs before Postgres sees them.',
      })
      .expect(400);

    await customer.agent
      .post('/community/comments')
      .send({
        titleId: '00000000-0000-4000-8000-000000000555',
        commentType: 'COMMENT',
        body: '   ',
      })
      .expect(400);

    await customer.agent
      .post('/community/reports')
      .send({
        commentId: 'not-a-uuid',
        category: 'ABUSE',
        notes: 'Malformed report target should fail validation.',
      })
      .expect(400);

    await customer.agent
      .post('/community/relationships/mute')
      .send({
        targetUserId: 'not-a-uuid',
        active: true,
      })
      .expect(400);

    await customer.agent
      .post('/community/favorites')
      .send({
        titleId: 'not-a-uuid',
        active: true,
      })
      .expect(400);

    await customer.agent
      .post('/community/subscriptions/authors')
      .send({
        targetId: 'not-a-uuid',
        active: true,
      })
      .expect(400);

    await customer.agent
      .put('/profiles/me')
      .send({
        deviceLabel: '   ',
        preferences: {
          ...customerProfile.body.preferences,
          updatedAt: new Date().toISOString(),
        },
      })
      .expect(400);

    await customer.agent.post('/auth/logout').expect(201);

    const moderator = await login('mod.noah', 'Moderator!2026', 'mod');
    await moderator.agent
      .post('/moderation/actions')
      .send({
        reportId: 'not-a-uuid',
        action: 'hide',
        notes: 'Malformed moderation target should fail validation.',
      })
      .expect(400);
    await moderator.agent
      .post('/moderation/actions')
      .send({
        action: 'hide',
        notes: '   ',
      })
      .expect(400);
    await moderator.agent.post('/auth/logout').expect(201);

    const clerk = await login('clerk.emma', 'Clerk!2026', 'pos');
    const validCart = await clerk.agent.post('/pos/carts').send({}).expect(201);

    await clerk.agent
      .post('/pos/carts/not-a-uuid/items')
      .send({ sku: 'SKU-BKMK-01', quantity: 1 })
      .expect(400);

    await clerk.agent
      .patch(`/pos/carts/${validCart.body.cartId}/items/not-a-uuid`)
      .send({ quantity: 1 })
      .expect(400);

    await clerk.agent
      .post('/pos/carts/not-a-uuid/review-total')
      .send({})
      .expect(400);

    await clerk.agent.post('/auth/logout').expect(201);

    const manager = await login('manager.li', 'Manager!2026', 'admin');
    await manager.agent
      .post('/admin/manifests/import')
      .send({
        supplierName: 'Validation Press',
        sourceFilename: 'invalid-manifest.json',
        statementReference: 'STMT-BAD-1',
        invoiceReference: 'INV-BAD-1',
        freightCents: 0,
        surchargeCents: 0,
        paymentPlanStatus: 'INVALID',
        items: [
          {
            sku: 'SKU-BKMK-01',
            statementQuantity: 1,
            invoiceQuantity: 1,
            statementExtendedAmountCents: 300,
            invoiceExtendedAmountCents: 300,
          },
        ],
      })
      .expect(400);
    await manager.agent
      .post('/admin/manifests/import')
      .send({
        supplierName: '   ',
        sourceFilename: 'invalid-manifest.json',
        statementReference: 'STMT-BLANK-1',
        invoiceReference: 'INV-BLANK-1',
        freightCents: 0,
        surchargeCents: 0,
        paymentPlanStatus: 'PENDING',
        items: [
          {
            sku: 'SKU-BKMK-01',
            statementQuantity: 1,
            invoiceQuantity: 1,
            statementExtendedAmountCents: 300,
            invoiceExtendedAmountCents: 300,
          },
        ],
      })
      .expect(400);
    await manager.agent
      .post('/admin/manifests/import')
      .send({
        supplierName: 'Validation Press',
        sourceFilename: '   ',
        statementReference: 'STMT-BLANK-2',
        invoiceReference: 'INV-BLANK-2',
        freightCents: 0,
        surchargeCents: 0,
        paymentPlanStatus: 'PENDING',
        items: [
          {
            sku: 'SKU-BKMK-01',
            statementQuantity: 1,
            invoiceQuantity: 1,
            statementExtendedAmountCents: 300,
            invoiceExtendedAmountCents: 300,
          },
        ],
      })
      .expect(400);
    await manager.agent
      .post('/admin/manifests/import')
      .send({
        supplierName: 'Validation Press',
        sourceFilename: 'invalid-manifest.json',
        statementReference: '   ',
        invoiceReference: 'INV-BLANK-3',
        freightCents: 0,
        surchargeCents: 0,
        paymentPlanStatus: 'PENDING',
        items: [
          {
            sku: 'SKU-BKMK-01',
            statementQuantity: 1,
            invoiceQuantity: 1,
            statementExtendedAmountCents: 300,
            invoiceExtendedAmountCents: 300,
          },
        ],
      })
      .expect(400);
    await manager.agent
      .post('/admin/manifests/import')
      .send({
        supplierName: 'Validation Press',
        sourceFilename: 'invalid-manifest.json',
        statementReference: 'STMT-BLANK-4',
        invoiceReference: '   ',
        freightCents: 0,
        surchargeCents: 0,
        paymentPlanStatus: 'PENDING',
        items: [
          {
            sku: 'SKU-BKMK-01',
            statementQuantity: 1,
            invoiceQuantity: 1,
            statementExtendedAmountCents: 300,
            invoiceExtendedAmountCents: 300,
          },
        ],
      })
      .expect(400);
    await manager.agent
      .post('/admin/manifests/import')
      .send({
        supplierName: 'Validation Press',
        sourceFilename: 'invalid-manifest.json',
        statementReference: 'STMT-BLANK-5',
        invoiceReference: 'INV-BLANK-5',
        freightCents: 0,
        surchargeCents: 0,
        paymentPlanStatus: 'PENDING',
        items: [
          {
            sku: '   ',
            statementQuantity: 1,
            invoiceQuantity: 1,
            statementExtendedAmountCents: 300,
            invoiceExtendedAmountCents: 300,
          },
        ],
      })
      .expect(400);
    await manager.agent.post('/auth/logout').expect(201);
  });

  it('enforces core role/workspace/status domains with DB-level constraints', async () => {
    const readerId = await findUserId('reader.ada');
    const moderatorId = await findUserId('mod.noah');
    const clerkId = await findUserId('clerk.emma');
    const title = await pool.query<{ id: string }>(
      "SELECT id FROM titles WHERE slug = 'quiet-harbor-digital'",
    );
    const comment = await pool.query<{ id: string }>(
      'SELECT id FROM comments WHERE title_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1',
      [title.rows[0]!.id],
    );

    await expect(
      pool.query("UPDATE users SET role = 'ROOT' WHERE id = $1", [readerId]),
    ).rejects.toThrow(/users_role_check|check constraint/i);

    const sessionToken = await issueSessionToken({
      userId: readerId,
      workspace: 'app',
      token: `domain-check-${Date.now()}`,
    });
    const sessionHash = createHash('sha256').update(sessionToken).digest('hex');
    await expect(
      pool.query("UPDATE sessions SET workspace = 'root' WHERE token_hash = $1", [sessionHash]),
    ).rejects.toThrow(/sessions_workspace_check|check constraint/i);
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sessionHash]);

    await expect(
      pool.query("UPDATE titles SET format = 'AUDIO' WHERE id = $1", [title.rows[0]!.id]),
    ).rejects.toThrow(/titles_format_check|check constraint/i);

    await expect(
      pool.query("UPDATE comments SET comment_type = 'THREAD' WHERE id = $1", [comment.rows[0]!.id]),
    ).rejects.toThrow(/comments_comment_type_check|check constraint/i);

    const report = await pool.query<{ id: string }>(
      `
      INSERT INTO reports (comment_id, reporter_user_id, category, notes)
      VALUES ($1, $2, 'ABUSE', 'Constraint coverage note.')
      RETURNING id
      `,
      [comment.rows[0]!.id, readerId],
    );
    await expect(
      pool.query("UPDATE reports SET status = 'DISMISSED' WHERE id = $1", [report.rows[0]!.id]),
    ).rejects.toThrow(/reports_status_check|check constraint/i);

    const moderationAction = await pool.query<{ id: string }>(
      `
      INSERT INTO moderation_actions (moderator_user_id, report_id, target_user_id, target_comment_id, action, notes)
      VALUES ($1, $2, $3, $4, 'hide', 'Constraint coverage action.')
      RETURNING id
      `,
      [moderatorId, report.rows[0]!.id, readerId, comment.rows[0]!.id],
    );
    await expect(
      pool.query("UPDATE moderation_actions SET action = 'banish' WHERE id = $1", [
        moderationAction.rows[0]!.id,
      ]),
    ).rejects.toThrow(/moderation_actions_action_check|check constraint/i);

    const cart = await pool.query<{ id: string }>(
      'INSERT INTO carts (clerk_user_id) VALUES ($1) RETURNING id',
      [clerkId],
    );
    await expect(
      pool.query("UPDATE carts SET status = 'ABANDONED' WHERE id = $1", [cart.rows[0]!.id]),
    ).rejects.toThrow(/carts_status_check|check constraint/i);

    const order = await pool.query<{ id: string }>(
      `
      INSERT INTO orders (cart_id, clerk_user_id, payment_method, payment_note_cipher, subtotal_cents, discount_cents, fee_cents, total_cents)
      VALUES ($1, $2, 'CASH', $3, 100, 0, 0, 100)
      RETURNING id
      `,
      [cart.rows[0]!.id, clerkId, encryptAtRestValue(encryptionKey(), 'Constraint coverage note')],
    );
    await expect(
      pool.query("UPDATE orders SET payment_method = 'WIRE_TRANSFER' WHERE id = $1", [order.rows[0]!.id]),
    ).rejects.toThrow(/orders_payment_method_check|check constraint/i);

    await pool.query('DELETE FROM orders WHERE id = $1', [order.rows[0]!.id]);
    await pool.query('DELETE FROM carts WHERE id = $1', [cart.rows[0]!.id]);
    await pool.query('DELETE FROM moderation_actions WHERE id = $1', [moderationAction.rows[0]!.id]);
    await pool.query('DELETE FROM reports WHERE id = $1', [report.rows[0]!.id]);
  });

  it('enforces attendance authorization and records successful clerk attendance writes', async () => {
    await agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .expect(401);

    const customer = await login('reader.ada', 'Reader!2026', 'app');
    await customer.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .expect(403);
    await customer.agent.get('/attendance/risks').expect(403);
    await customer.agent.post('/auth/logout').expect(201);

    const clerk = await login('clerk.emma', 'Clerk!2026', 'pos');
    const clockIn = await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date(Date.now() - 60_000).toISOString())
      .expect(201);
    expect(clockIn.body.recordId).toBeTruthy();

    const clockOut = await clerk.agent
      .post('/attendance/clock-out')
      .field('occurredAt', new Date().toISOString())
      .expect(201);
    expect(clockOut.body.recordId).toBeTruthy();

    const clerkAttendance = await pool.query<{ event_type: string }>(
      `
      SELECT event_type
      FROM attendance_records
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 2
      `,
      [clerk.user.id],
    );
    expect(clerkAttendance.rows.map((row) => row.event_type)).toEqual(['CLOCK_OUT', 'CLOCK_IN']);

    await pool.query('TRUNCATE TABLE risk_alerts, attendance_records RESTART IDENTITY CASCADE');

    await clerk.agent.post('/auth/logout').expect(201);
  });
});
