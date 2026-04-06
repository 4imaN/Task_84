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

describe('LedgerRead API (community-pos)', () => {
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

  it('runs the customer flow with profile isolation, masking, sync conflicts, and trace logging', async () => {
    const customer = await login('reader.ada', 'Reader!2026', 'app');
    const otherCustomerId = await findUserId('reader.mei');
    const title = await pool.query<{ id: string; author_id: string; series_id: string | null }>(
      "SELECT id, author_id, series_id FROM titles WHERE slug = 'quiet-harbor-digital'",
    );
    const unreadableTitles = await pool.query<{ id: string; slug: string; name: string }>(
      `
      SELECT id, slug, name
      FROM titles
      WHERE slug IN ('quiet-harbor-print', 'staff-handbook')
      ORDER BY slug ASC
      `,
    );

    await customer.agent.get('/auth/session').expect(200);

    const myProfile = await customer.agent.get('/profiles/me').expect(200);
    expect(myProfile.body.username).toBe('reader.ada');
    const storedUser = await pool.query<{
      username: string | null;
      username_cipher: string | null;
      username_lookup_hash: string | null;
    }>(
      `
      SELECT username, username_cipher, username_lookup_hash
      FROM users
      WHERE id = $1
      `,
      [customer.user.id],
    );
    expect(storedUser.rows[0]!.username).toBeNull();
    expect(storedUser.rows[0]!.username_cipher).toBeTruthy();
    expect(storedUser.rows[0]!.username_lookup_hash).toBe(usernameHash('reader.ada'));

    const updatedProfile = await customer.agent
      .put('/profiles/me')
      .send({
        deviceLabel: 'Reviewer Tablet',
        preferences: {
          ...myProfile.body.preferences,
          fontSize: 20,
          updatedAt: new Date().toISOString(),
        },
      })
      .expect(200);

    await customer.agent
      .put('/profiles/me')
      .send({
        deviceLabel: 'Imported Tablet',
        preferences: {
          ...myProfile.body.preferences,
          fontSize: 18,
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
      })
      .expect(409);

    await customer.agent
      .get(`/profiles/${otherCustomerId}`)
      .expect(404);

    await customer.agent
      .post('/profiles/me/sync')
      .send({
        deviceLabel: 'Old Device',
        strict: true,
        preferences: {
          ...myProfile.body.preferences,
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      })
      .expect(409);

    const serverWonSync = await customer.agent
      .post('/profiles/me/sync')
      .send({
        deviceLabel: 'Imported Kiosk',
        strict: false,
        preferences: {
          ...myProfile.body.preferences,
          fontSize: 16,
          updatedAt: '2025-01-02T00:00:00.000Z',
        },
      })
      .expect(201);
    expect(serverWonSync.body.resolution).toBe('SERVER_WON');
    expect(serverWonSync.body.profile.updatedAt).toBe(updatedProfile.body.updatedAt);
    expect(serverWonSync.body.profile.deviceLabel).toBe(updatedProfile.body.deviceLabel);

    const catalog = await graphql<{
      catalog: {
        featured: Array<{ id: string; name: string; format: string; isReadable: boolean }>;
        bestSellers: Array<{ id: string; name: string; format: string; isReadable: boolean }>;
      };
    }>(
      customer.agent,
      'query { catalog { featured { id name format isReadable } bestSellers { id name format isReadable } } }',
    );
    expect(catalog.catalog.featured.length).toBeGreaterThan(0);
    const catalogEntries = [...catalog.catalog.featured, ...catalog.catalog.bestSellers];
    const featuredUnreadable = catalog.catalog.featured.filter((entry) =>
      unreadableTitles.rows.some((titleRow) => titleRow.id === entry.id),
    );
    const bestSellerUnreadable = catalog.catalog.bestSellers.filter((entry) =>
      unreadableTitles.rows.some((titleRow) => titleRow.id === entry.id),
    );
    expect(featuredUnreadable.length).toBeGreaterThan(0);
    expect(bestSellerUnreadable.length).toBeGreaterThan(0);
    expect(
      catalogEntries.some((entry) => entry.format === 'PHYSICAL' && entry.isReadable === false),
    ).toBe(true);
    expect(
      catalogEntries.some((entry) => entry.format === 'BUNDLE' && entry.isReadable === false),
    ).toBe(true);
    expect(
      catalogEntries.some((entry) => entry.format === 'DIGITAL' && entry.isReadable === true),
    ).toBe(true);

    const titleResponse = await graphql<{
      title: { id: string; name: string; isReadable: boolean; chapters: Array<{ id: string; name: string; body: string }> };
    }>(
      customer.agent,
      'query ($id: String!) { title(id: $id) { id name isReadable chapters { id name body } } }',
      { id: title.rows[0]!.id },
    );
    expect(titleResponse.title.isReadable).toBe(true);
    expect(titleResponse.title.chapters.length).toBeGreaterThan(0);

    for (const unreadableTitle of unreadableTitles.rows) {
      await customer.agent
        .post(GRAPHQL)
        .send({
          query:
            'query ($id: String!) { title(id: $id) { id name isReadable chapters { id } } }',
          variables: { id: unreadableTitle.id },
        })
        .expect(200)
        .expect(({ body }) => {
          expect(body.errors?.[0]?.message).toBe('This title is not available in the reader workspace.');
        });

      const communityResponse = await customer.agent
        .post(GRAPHQL)
        .send({
          query:
            'query ($titleId: String!) { communityThread(titleId: $titleId) { titleId totalRatings comments { id } } }',
          variables: { titleId: unreadableTitle.id },
        })
        .expect(200);
      expect(communityResponse.body.errors).toBeUndefined();
      expect(communityResponse.body.data?.communityThread?.titleId).toBe(unreadableTitle.id);
    }

    const tracesBefore = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM recommendation_traces WHERE title_id = $1',
      [title.rows[0]!.id],
    );
    const recommendationsFirst = await graphql<{
      recommendations: { titleId: string; reason: string; recommendedTitleIds: string[]; traceId: string };
    }>(
      customer.agent,
      'query ($titleId: String!) { recommendations(titleId: $titleId) { titleId reason recommendedTitleIds traceId } }',
      { titleId: title.rows[0]!.id },
    );
    const recommendationsSecond = await graphql<{
      recommendations: { titleId: string; reason: string; recommendedTitleIds: string[]; traceId: string };
    }>(
      customer.agent,
      'query ($titleId: String!) { recommendations(titleId: $titleId) { titleId reason recommendedTitleIds traceId } }',
      { titleId: title.rows[0]!.id },
    );
    expect(recommendationsFirst.recommendations.recommendedTitleIds.length).toBeGreaterThan(0);
    expect(recommendationsSecond.recommendations.recommendedTitleIds.length).toBeGreaterThan(0);

    const tracesAfter = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM recommendation_traces WHERE title_id = $1',
      [title.rows[0]!.id],
    );
    expect(Number(tracesAfter.rows[0]!.count) - Number(tracesBefore.rows[0]!.count)).toBe(2);

    const recentStrategies = await pool.query<{ strategy: string }>(
      `
      SELECT strategy
      FROM recommendation_traces
      WHERE title_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 2
      `,
      [title.rows[0]!.id],
    );
    expect(recentStrategies.rows.map((row) => row.strategy)).toEqual(
      expect.arrayContaining(['CACHE_HIT']),
    );

    const threadBeforeMask = await graphql<{
      communityThread: {
        titleId: string;
        comments: Array<{
          id: string;
          authorId: string;
          commentType: string;
          createdAt: string;
          visibleBody: string;
          replies: Array<{ id: string; authorId: string; visibleBody: string }>;
        }>;
      };
    }>(
      customer.agent,
      `
        query ($titleId: String!) {
          communityThread(titleId: $titleId) {
            titleId
            comments {
              id
              authorId
              commentType
              createdAt
              visibleBody
              replies {
                id
                authorId
                visibleBody
              }
            }
          }
        }
      `,
      { titleId: title.rows[0]!.id },
    );
    expect(threadBeforeMask.communityThread.comments.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(threadBeforeMask.communityThread.comments[0]!.createdAt))).toBe(false);
    const meiRootComment = threadBeforeMask.communityThread.comments.find(
      (comment) => comment.authorId === otherCustomerId,
    );
    expect(meiRootComment?.visibleBody).toContain('late-night reading');

    const newCommentBody = `Local review note ${Date.now()}`;
    await customer.agent
      .post('/community/comments')
      .send({
        titleId: title.rows[0]!.id,
        commentType: 'COMMENT',
        body: newCommentBody,
      })
      .expect(201);

    await customer.agent
      .post('/community/comments')
      .send({
        titleId: title.rows[0]!.id,
        commentType: 'COMMENT',
        body: newCommentBody,
      })
      .expect(409);

    await customer.agent
      .post('/community/ratings')
      .send({
        titleId: title.rows[0]!.id,
        rating: 5,
      })
      .expect(201);

    await customer.agent
      .post('/community/favorites')
      .send({
        titleId: title.rows[0]!.id,
        active: true,
      })
      .expect(201);

    await customer.agent
      .post('/community/subscriptions/authors')
      .send({
        targetId: title.rows[0]!.author_id,
        active: true,
      })
      .expect(201);

    await customer.agent
      .post('/community/subscriptions/series')
      .send({
        targetId: title.rows[0]!.series_id,
        active: true,
      })
      .expect(201);

    await customer.agent
      .post('/community/relationships/mute')
      .send({
        targetUserId: otherCustomerId,
        active: true,
      })
      .expect(201);

    await customer.agent
      .post('/community/relationships/block')
      .send({
        targetUserId: otherCustomerId,
        active: true,
      })
      .expect(201);

    const threadAfterMask = await graphql<{
      communityThread: {
        comments: Array<{ id: string; authorId: string; visibleBody: string }>;
      };
    }>(
      customer.agent,
      `
        query ($titleId: String!) {
          communityThread(titleId: $titleId) {
            comments {
              id
              authorId
              visibleBody
            }
          }
        }
      `,
      { titleId: title.rows[0]!.id },
    );
    expect(
      threadAfterMask.communityThread.comments.find(
        (comment) => comment.authorId === otherCustomerId,
      )?.visibleBody,
    ).toBe('[masked for viewer policy]');

    await customer.agent
      .post('/community/reports')
      .send({
        commentId: meiRootComment!.id,
        category: 'ABUSE',
        notes: 'Testing the moderation pipeline from the reader workspace.',
      })
      .expect(201);

    await customer.agent.get('/moderation/queue').expect(403);
    await customer.agent.post('/pos/carts').send({}).expect(403);
    await customer.agent.post('/auth/logout').expect(201);
  });

  it('rejects sensitive words and per-minute community spam bursts', async () => {
    const customer = await login('reader.mei', 'Reader!2026', 'app');
    const title = await pool.query<{ id: string }>(
      "SELECT id FROM titles WHERE slug = 'quiet-harbor-digital'",
    );

    await pool.query(
      `
      UPDATE comments
      SET created_at = NOW() - INTERVAL '2 minutes'
      WHERE user_id = $1
      `,
      [customer.user.id],
    );

    await customer.agent
      .post('/community/comments')
      .send({
        titleId: title.rows[0]!.id,
        commentType: 'COMMENT',
        body: 'This spoiler should be rejected locally.',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body.message).toBe('The comment contains prohibited content.');
        expect(JSON.stringify(body)).not.toContain('spoiler');
      });

    for (let index = 0; index < 10; index += 1) {
      await customer.agent
        .post('/community/comments')
        .send({
          titleId: title.rows[0]!.id,
          commentType: 'COMMENT',
          body: `rate-limit-${Date.now()}-${index}`,
        })
        .expect(201);
    }

    await customer.agent
      .post('/community/comments')
      .send({
        titleId: title.rows[0]!.id,
        commentType: 'COMMENT',
        body: `rate-limit-overflow-${Date.now()}`,
      })
      .expect(409);

    await customer.agent.post('/auth/logout').expect(201);
  });

  it('enforces duplicate-window protection under parallel community comment submissions', async () => {
    const customer = await login('reader.ada', 'Reader!2026', 'app');
    const title = await pool.query<{ id: string }>(
      "SELECT id FROM titles WHERE slug = 'quiet-harbor-digital'",
    );

    await pool.query(
      `
      UPDATE comments
      SET created_at = NOW() - INTERVAL '2 minutes'
      WHERE user_id = $1
      `,
      [customer.user.id],
    );

    const duplicateBody = `parallel-duplicate-${Date.now()}`;
    const [firstAttempt, secondAttempt] = await Promise.all([
      customer.agent.post('/community/comments').send({
        titleId: title.rows[0]!.id,
        commentType: 'COMMENT',
        body: duplicateBody,
      }),
      customer.agent.post('/community/comments').send({
        titleId: title.rows[0]!.id,
        commentType: 'COMMENT',
        body: duplicateBody,
      }),
    ]);

    const statuses = [firstAttempt.status, secondAttempt.status].sort((left, right) => left - right);
    expect(statuses).toEqual([201, 409]);
    const conflictResponse = firstAttempt.status === 409 ? firstAttempt : secondAttempt;
    expect(conflictResponse.body.message).toBe('Duplicate content detected in the last 60 seconds.');

    const stored = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM comments
      WHERE user_id = $1
        AND body = $2
      `,
      [customer.user.id, duplicateBody],
    );
    expect(Number(stored.rows[0]!.count)).toBe(1);

    await customer.agent.post('/auth/logout').expect(201);
  });

  it('enforces per-minute community rate limits under parallel submissions', async () => {
    const customer = await login('reader.mei', 'Reader!2026', 'app');
    const title = await pool.query<{ id: string }>(
      "SELECT id FROM titles WHERE slug = 'quiet-harbor-digital'",
    );

    await pool.query(
      `
      UPDATE comments
      SET created_at = NOW() - INTERVAL '2 minutes'
      WHERE user_id = $1
      `,
      [customer.user.id],
    );

    for (let index = 0; index < 9; index += 1) {
      await customer.agent
        .post('/community/comments')
        .send({
          titleId: title.rows[0]!.id,
          commentType: 'COMMENT',
          body: `parallel-rate-limit-${Date.now()}-${index}`,
        })
        .expect(201);
    }

    const [attemptA, attemptB] = await Promise.all([
      customer.agent.post('/community/comments').send({
        titleId: title.rows[0]!.id,
        commentType: 'COMMENT',
        body: `parallel-rate-limit-final-a-${Date.now()}`,
      }),
      customer.agent.post('/community/comments').send({
        titleId: title.rows[0]!.id,
        commentType: 'COMMENT',
        body: `parallel-rate-limit-final-b-${Date.now()}`,
      }),
    ]);

    const statuses = [attemptA.status, attemptB.status].sort((left, right) => left - right);
    expect(statuses).toEqual([201, 409]);
    const conflictResponse = attemptA.status === 409 ? attemptA : attemptB;
    expect(conflictResponse.body.message).toBe('Comment rate limit reached for the current minute.');

    const minuteCount = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM comments
      WHERE user_id = $1
        AND created_at >= NOW() - INTERVAL '1 minute'
      `,
      [customer.user.id],
    );
    expect(Number(minuteCount.rows[0]!.count)).toBe(10);

    await pool.query(
      `
      UPDATE comments
      SET created_at = NOW() - INTERVAL '2 minutes'
      WHERE user_id = $1
      `,
      [customer.user.id],
    );

    await customer.agent.post('/auth/logout').expect(201);
  });

  it('enforces same-title reply integrity and rejects blank report metadata', async () => {
    const customer = await login('reader.ada', 'Reader!2026', 'app');
    const quietHarbor = await pool.query<{ id: string }>(
      "SELECT id FROM titles WHERE slug = 'quiet-harbor-digital'",
    );
    const alternateTitle = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM titles
      WHERE id <> $1
      ORDER BY created_at ASC
      LIMIT 1
      `,
      [quietHarbor.rows[0]!.id],
    );
    const quietHarborParent = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM comments
      WHERE title_id = $1
      ORDER BY created_at ASC
      LIMIT 1
      `,
      [quietHarbor.rows[0]!.id],
    );

    const sameTitleReply = await customer.agent
      .post('/community/comments')
      .send({
        titleId: quietHarbor.rows[0]!.id,
        parentCommentId: quietHarborParent.rows[0]!.id,
        commentType: 'QUESTION',
        body: `reply-integrity-${Date.now()}`,
      })
      .expect(201);
    expect(sameTitleReply.body.id).toBeTruthy();

    const otherTitleParent = await customer.agent
      .post('/community/comments')
      .send({
        titleId: alternateTitle.rows[0]!.id,
        commentType: 'COMMENT',
        body: `cross-title-parent-${Date.now()}`,
      })
      .expect(201);

    await customer.agent
      .post('/community/comments')
      .send({
        titleId: quietHarbor.rows[0]!.id,
        parentCommentId: otherTitleParent.body.id,
        commentType: 'QUESTION',
        body: `cross-title-reply-${Date.now()}`,
      })
      .expect(400);

    await customer.agent
      .post('/community/reports')
      .send({
        commentId: '   ',
        category: 'ABUSE',
        notes: 'Valid notes',
      })
      .expect(400);

    await customer.agent
      .post('/community/reports')
      .send({
        commentId: quietHarborParent.rows[0]!.id,
        category: '   ',
        notes: 'Valid notes',
      })
      .expect(400);

    await customer.agent
      .post('/community/reports')
      .send({
        commentId: quietHarborParent.rows[0]!.id,
        category: 'ABUSE',
        notes: '   ',
      })
      .expect(400);

    await customer.agent
      .post('/community/reports')
      .send({
        commentId: quietHarborParent.rows[0]!.id,
        category: 'ABUSE',
        notes: 'Valid governance report metadata.',
      })
      .expect(201);

    await customer.agent
      .post('/community/relationships/mute')
      .send({
        targetUserId: '   ',
        active: true,
      })
      .expect(400);

    await customer.agent
      .post('/community/relationships/block')
      .send({
        targetUserId: '',
        active: true,
      })
      .expect(400);

    await customer.agent.post('/auth/logout').expect(201);
  });

  it('falls back to best sellers when recommendation snapshots are empty and records the fallback reason', async () => {
    const customer = await login('reader.ada', 'Reader!2026', 'app');
    const title = await pool.query<{ id: string }>(
      "SELECT id FROM titles WHERE slug = 'midnight-ledger-digital'",
    );
    const originalSnapshots = await pool.query<{ snapshot_type: string; recommended_title_ids: string[] }>(
      `
      SELECT snapshot_type, recommended_title_ids
      FROM recommendation_snapshots
      WHERE title_id = $1
      `,
      [title.rows[0]!.id],
    );

    await pool.query(
      `
      UPDATE recommendation_snapshots
      SET recommended_title_ids = '[]'::jsonb
      WHERE title_id = $1
      `,
      [title.rows[0]!.id],
    );

    try {
      const response = await graphql<{
        recommendations: { titleId: string; reason: string; recommendedTitleIds: string[]; traceId: string };
      }>(
        customer.agent,
        'query ($titleId: String!) { recommendations(titleId: $titleId) { titleId reason recommendedTitleIds traceId } }',
        { titleId: title.rows[0]!.id },
      );

      expect(response.recommendations.reason).toBe('BESTSELLER_FALLBACK');
      expect(response.recommendations.recommendedTitleIds.length).toBeGreaterThan(0);

      const trace = await pool.query<{ strategy: string }>(
        `
        SELECT strategy
        FROM recommendation_traces
        WHERE trace_id = $1
        LIMIT 1
        `,
        [response.recommendations.traceId],
      );
      expect(trace.rows[0]!.strategy).toBe('EMPTY_SNAPSHOT_FALLBACK');
    } finally {
      for (const snapshot of originalSnapshots.rows) {
        await pool.query(
          `
          UPDATE recommendation_snapshots
          SET recommended_title_ids = $2::jsonb
          WHERE title_id = $1
            AND snapshot_type = $3
          `,
          [title.rows[0]!.id, JSON.stringify(snapshot.recommended_title_ids), snapshot.snapshot_type],
        );
      }
    }

    await customer.agent.post('/auth/logout').expect(201);
  });

  it('returns controlled 404s for valid-but-missing community relationship and subscription targets', async () => {
    const customer = await login('reader.ada', 'Reader!2026', 'app');

    await customer.agent
      .post('/community/relationships/block')
      .send({
        targetUserId: '00000000-0000-4000-8000-000000000111',
        active: true,
      })
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe('Target user not found.');
      });

    await customer.agent
      .post('/community/subscriptions/authors')
      .send({
        targetId: '00000000-0000-4000-8000-000000000222',
        active: true,
      })
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe('Author not found.');
      });

    await customer.agent
      .post('/community/subscriptions/series')
      .send({
        targetId: '00000000-0000-4000-8000-000000000333',
        active: true,
      })
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe('Series not found.');
      });

    await customer.agent
      .post('/community/favorites')
      .send({
        titleId: '00000000-0000-4000-8000-000000000444',
        active: true,
      })
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe('Title not found.');
      });

    await customer.agent.post('/auth/logout').expect(201);
  });

  it('rejects self-target block and mute relationships at API and DB layers', async () => {
    const customer = await login('reader.ada', 'Reader!2026', 'app');

    await customer.agent
      .post('/community/relationships/mute')
      .send({
        targetUserId: customer.user.id,
        active: true,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toBe('You cannot mute yourself.');
      });

    await customer.agent
      .post('/community/relationships/block')
      .send({
        targetUserId: customer.user.id,
        active: true,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toBe('You cannot block yourself.');
      });

    await expect(
      pool.query(
        `
        INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
        VALUES ($1, $1)
        `,
        [customer.user.id],
      ),
    ).rejects.toThrow('user_blocks_no_self_target');

    await expect(
      pool.query(
        `
        INSERT INTO user_mutes (muter_user_id, muted_user_id)
        VALUES ($1, $1)
        `,
        [customer.user.id],
      ),
    ).rejects.toThrow('user_mutes_no_self_target');

    await customer.agent.post('/auth/logout').expect(201);
  });

  it('enforces review-before-checkout and validates evidence upload boundaries', async () => {
    const clerk = await login('clerk.emma', 'Clerk!2026', 'pos');
    const search = await clerk.agent.get('/pos/search?q=qui').expect(200);
    expect(search.body.some((item: { sku: string }) => item.sku === 'SKU-QH-PRINT')).toBe(true);

    const cartWithoutReview = await clerk.agent.post('/pos/carts').send({}).expect(201);
    const adjustableLine = await clerk.agent
      .post(`/pos/carts/${cartWithoutReview.body.cartId}/items`)
      .send({ sku: 'SKU-BKMK-01', quantity: 2 })
      .expect(201);
    expect(adjustableLine.body.items[0].quantity).toBe(2);

    await clerk.agent
      .post(`/pos/carts/${cartWithoutReview.body.cartId}/checkout`)
      .send({ paymentMethod: 'CASH', paymentNote: 'Skip review attempt' })
      .expect(409);

    const adjustedLine = await clerk.agent
      .patch(
        `/pos/carts/${cartWithoutReview.body.cartId}/items/${adjustableLine.body.items[0].cartItemId}`,
      )
      .send({ quantity: 1 })
      .expect(200);
    expect(adjustedLine.body.items[0].quantity).toBe(1);
    expect(adjustedLine.body.reviewReady).toBe(false);

    await clerk.agent
      .post(`/pos/carts/${cartWithoutReview.body.cartId}/checkout`)
      .send({ paymentMethod: 'CASH', paymentNote: 'Adjusted cart without re-review' })
      .expect(409);

    const removedLine = await clerk.agent
      .delete(
        `/pos/carts/${cartWithoutReview.body.cartId}/items/${adjustedLine.body.items[0].cartItemId}`,
      )
      .expect(200);
    expect(removedLine.body.items).toHaveLength(0);
    expect(removedLine.body.reviewReady).toBe(false);

    const cart = await clerk.agent.post('/pos/carts').send({}).expect(201);
    await clerk.agent
      .post(`/pos/carts/${cart.body.cartId}/items`)
      .send({ sku: 'MISSING-SKU', quantity: 1 })
      .expect(404);

    await clerk.agent
      .post(`/pos/carts/${cart.body.cartId}/items`)
      .send({ sku: 'SKU-BKMK-01', quantity: 2 })
      .expect(201);

    const review = await clerk.agent
      .post(`/pos/carts/${cart.body.cartId}/review-total`)
      .send({})
      .expect(201);
    expect(review.body.reviewReady).toBe(true);
    expect(review.body.total).toBeGreaterThan(0);

    const bundleCart = await clerk.agent.post('/pos/carts').send({}).expect(201);
    await clerk.agent
      .post(`/pos/carts/${bundleCart.body.cartId}/items`)
      .send({ sku: 'SKU-QH-PRINT', quantity: 1 })
      .expect(201);
    await clerk.agent
      .post(`/pos/carts/${bundleCart.body.cartId}/items`)
      .send({ sku: 'SKU-BKMK-01', quantity: 1 })
      .expect(201);
    const bundleReview = await clerk.agent
      .post(`/pos/carts/${bundleCart.body.cartId}/review-total`)
      .send({})
      .expect(201);
    expect(bundleReview.body.discount).toBe(3);

    const checkout = await clerk.agent
      .post(`/pos/carts/${cart.body.cartId}/checkout`)
      .send({ paymentMethod: 'CASH', paymentNote: 'Till 1 cash drop' })
      .expect(201);
    expect(checkout.body.orderId).toBeTruthy();

    const order = await pool.query<{ total_cents: number; payment_note_cipher: string }>(
      'SELECT total_cents, payment_note_cipher FROM orders WHERE id = $1',
      [checkout.body.orderId],
    );
    expect(order.rows[0]!.total_cents / 100).toBe(review.body.total);
    expect(order.rows[0]!.payment_note_cipher).not.toBe('Till 1 cash drop');
    expect(decryptAtRest(order.rows[0]!.payment_note_cipher)).toBe('Till 1 cash drop');

    const priceShiftCart = await clerk.agent.post('/pos/carts').send({}).expect(201);
    await clerk.agent
      .post(`/pos/carts/${priceShiftCart.body.cartId}/items`)
      .send({ sku: 'SKU-QH-PRINT', quantity: 1 })
      .expect(201);
    await clerk.agent
      .post(`/pos/carts/${priceShiftCart.body.cartId}/review-total`)
      .send({})
      .expect(201);

    const inventoryBeforeTamper = await pool.query<{ on_hand: number; price_cents: number }>(
      "SELECT on_hand, price_cents FROM inventory_items WHERE sku = 'SKU-QH-PRINT'",
    );
    await pool.query(
      "UPDATE inventory_items SET price_cents = price_cents + 100 WHERE sku = 'SKU-QH-PRINT'",
    );

    await clerk.agent
      .post(`/pos/carts/${priceShiftCart.body.cartId}/checkout`)
      .send({ paymentMethod: 'CASH', paymentNote: 'stale review test' })
      .expect(409);

    const orderCount = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM orders WHERE cart_id = $1',
      [priceShiftCart.body.cartId],
    );
    expect(Number(orderCount.rows[0]!.count)).toBe(0);

    await pool.query(
      "UPDATE inventory_items SET price_cents = $2, on_hand = $3 WHERE sku = $1",
      [
        'SKU-QH-PRINT',
        inventoryBeforeTamper.rows[0]!.price_cents,
        inventoryBeforeTamper.rows[0]!.on_hand,
      ],
    );

    await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .field('expectedChecksum', 'missing-file')
      .expect(400);

    await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .field('expectedChecksum', 'checksum-not-used')
      .attach('evidence', Buffer.from('not-an-image'), {
        filename: 'bad.txt',
        contentType: 'text/plain',
      })
      .expect(400);

    await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .field('expectedChecksum', 'too-large')
      .attach(
        'evidence',
        Buffer.concat([
          VALID_PNG,
          Buffer.alloc(DEFAULT_ATTENDANCE_EVIDENCE_MAX_BYTES - VALID_PNG.length + 1, 0),
        ]),
        {
          filename: 'oversized-proof.png',
          contentType: 'image/png',
        },
      )
      .expect(413)
      .expect(({ body }) => {
        expect(body.message).toBe('Evidence files must be 5 MiB or smaller.');
      });

    await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .field('expectedChecksum', 'expected-but-wrong')
      .attach('evidence', Buffer.from('png-like-binary'), { filename: 'proof.png', contentType: 'image/png' })
      .expect(400);

    const attendanceCountBeforeMismatch = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM attendance_records WHERE user_id = $1',
      [clerk.user.id],
    );

    await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .field('expectedChecksum', 'expected-but-wrong')
      .attach('evidence', VALID_PNG, {
        filename: '../../../proof.png',
        contentType: 'image/png',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toBe('Evidence checksum did not match the uploaded file.');
      });

    const attendanceCountAfterMismatch = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM attendance_records WHERE user_id = $1',
      [clerk.user.id],
    );
    expect(attendanceCountAfterMismatch.rows[0]!.count).toBe(attendanceCountBeforeMismatch.rows[0]!.count);

    await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .field('expectedChecksum', checksumOf(VALID_PNG))
      .attach('evidence', VALID_PNG, {
        filename: '../../../proof.png',
        contentType: 'image/png',
      })
      .expect(201);

    const latestEvidence = await pool.query<{ evidence_path: string }>(
      `
      SELECT evidence_path
      FROM attendance_records
      WHERE evidence_path IS NOT NULL
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
    );
    expect(latestEvidence.rows[0]!.evidence_path.startsWith('/tmp/ledgerread-evidence')).toBe(true);
    expect(latestEvidence.rows[0]!.evidence_path.includes('..')).toBe(false);

    const risks = await clerk.agent.get('/attendance/risks').expect(200);
    expect(
      risks.body.some((risk: { description: string }) => risk.description.includes('checksum mismatch')),
    ).toBe(true);

    await clerk.agent
      .post('/attendance/clock-out')
      .field('occurredAt', new Date().toISOString())
      .expect(201);

    await clerk.agent.post('/auth/logout').expect(201);
  });

  it('serializes checkout against concurrent cart-item quantity updates', async () => {
    const clerk = await login('clerk.emma', 'Clerk!2026', 'pos');
    const cart = await clerk.agent.post('/pos/carts').send({}).expect(201);
    const added = await clerk.agent
      .post(`/pos/carts/${cart.body.cartId}/items`)
      .send({ sku: 'SKU-BKMK-01', quantity: 1 })
      .expect(201);
    const cartItemId = added.body.items[0].cartItemId as string;

    await clerk.agent.post(`/pos/carts/${cart.body.cartId}/review-total`).send({}).expect(201);

    const lockClient = await pool.connect();
    try {
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT id FROM carts WHERE id = $1 FOR UPDATE', [cart.body.cartId]);

      const checkoutRequest = clerk.agent
        .post(`/pos/carts/${cart.body.cartId}/checkout`)
        .send({ paymentMethod: 'CASH', paymentNote: 'checkout-lock-race' });

      await new Promise((resolveRace) => setTimeout(resolveRace, 75));

      const mutationRequest = clerk.agent
        .patch(`/pos/carts/${cart.body.cartId}/items/${cartItemId}`)
        .send({ quantity: 3 });

      await lockClient.query('COMMIT');

      const [checkoutResponse, mutationResponse] = await Promise.all([checkoutRequest, mutationRequest]);
      expect(checkoutResponse.status).toBe(201);
      expect(mutationResponse.status).toBe(409);
      expect(mutationResponse.body.message).toBe('Only open carts can be modified.');
    } finally {
      await lockClient.query('ROLLBACK').catch(() => undefined);
      lockClient.release();
    }

    const finalCart = await pool.query<{ status: string }>('SELECT status FROM carts WHERE id = $1', [
      cart.body.cartId,
    ]);
    expect(finalCart.rows[0]!.status).toBe('CHECKED_OUT');

    const finalLine = await pool.query<{ quantity: number }>('SELECT quantity FROM cart_items WHERE id = $1', [
      cartItemId,
    ]);
    expect(finalLine.rows[0]!.quantity).toBe(1);

    await clerk.agent.post('/auth/logout').expect(201);
  });

  it('serializes checkout against concurrent cart-item additions', async () => {
    const clerk = await login('clerk.emma', 'Clerk!2026', 'pos');
    const cart = await clerk.agent.post('/pos/carts').send({}).expect(201);
    await clerk.agent
      .post(`/pos/carts/${cart.body.cartId}/items`)
      .send({ sku: 'SKU-BKMK-01', quantity: 1 })
      .expect(201);
    await clerk.agent.post(`/pos/carts/${cart.body.cartId}/review-total`).send({}).expect(201);

    const lockClient = await pool.connect();
    try {
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT id FROM carts WHERE id = $1 FOR UPDATE', [cart.body.cartId]);

      const checkoutRequest = clerk.agent
        .post(`/pos/carts/${cart.body.cartId}/checkout`)
        .send({ paymentMethod: 'CASH', paymentNote: 'checkout-vs-add-race' });

      await new Promise((resolveRace) => setTimeout(resolveRace, 75));

      const addRequest = clerk.agent
        .post(`/pos/carts/${cart.body.cartId}/items`)
        .send({ sku: 'SKU-BKMK-01', quantity: 1 });

      await lockClient.query('COMMIT');

      const [checkoutResponse, addResponse] = await Promise.all([checkoutRequest, addRequest]);
      const statuses = [checkoutResponse.status, addResponse.status].sort((left, right) => left - right);
      expect(statuses).toEqual([201, 409]);
      if (checkoutResponse.status === 201) {
        expect(addResponse.status).toBe(409);
        expect(addResponse.body.message).toBe('Only open carts can be modified.');
      } else {
        expect(addResponse.status).toBe(201);
        expect(checkoutResponse.status).toBe(409);
        expect([
          'The cart changed after review. Run review total again before checkout.',
          'Review total must be completed before checkout.',
        ]).toContain(checkoutResponse.body.message);
      }
    } finally {
      await lockClient.query('ROLLBACK').catch(() => undefined);
      lockClient.release();
    }

    const orderItems = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM order_items
      JOIN orders ON orders.id = order_items.order_id
      WHERE orders.cart_id = $1
      `,
      [cart.body.cartId],
    );
    const orderItemCount = Number(orderItems.rows[0]!.count);
    expect([0, 1]).toContain(orderItemCount);

    await clerk.agent.post('/auth/logout').expect(201);
  });

  it('prevents one clerk from modifying, reviewing, or checking out another clerk’s cart', async () => {
    const ownerClerk = await login('clerk.emma', 'Clerk!2026', 'pos');
    const otherClerk = await login('clerk.oliver', 'ClerkTwo!2026', 'pos');

    const cart = await ownerClerk.agent.post('/pos/carts').send({}).expect(201);
    const line = await ownerClerk.agent
      .post(`/pos/carts/${cart.body.cartId}/items`)
      .send({ sku: 'SKU-BKMK-01', quantity: 1 })
      .expect(201);
    const cartItemId = line.body.items[0].cartItemId;

    await otherClerk.agent
      .patch(`/pos/carts/${cart.body.cartId}/items/${cartItemId}`)
      .send({ quantity: 2 })
      .expect(404);

    await otherClerk.agent
      .post(`/pos/carts/${cart.body.cartId}/review-total`)
      .send({})
      .expect(404);

    await otherClerk.agent
      .post(`/pos/carts/${cart.body.cartId}/checkout`)
      .send({ paymentMethod: 'CASH', paymentNote: 'Not your cart' })
      .expect(404);

    await ownerClerk.agent.post('/auth/logout').expect(201);
    await otherClerk.agent.post('/auth/logout').expect(201);
  });

  it('serializes concurrent attendance writes into a linear hash chain', async () => {
    const clerk = await login('clerk.emma', 'Clerk!2026', 'pos');
    const baseTime = Date.now();

    const [clockIn, clockOut] = await Promise.all([
      clerk.agent
        .post('/attendance/clock-in')
        .field('occurredAt', new Date(baseTime - 1000).toISOString()),
      clerk.agent
        .post('/attendance/clock-out')
        .field('occurredAt', new Date(baseTime).toISOString()),
    ]);

    expect(clockIn.status).toBe(201);
    expect(clockOut.status).toBe(201);

    const attendanceChain = await pool.query<{
      previous_hash: string | null;
      current_hash: string;
    }>(
      `
      SELECT previous_hash, current_hash
      FROM attendance_records
      ORDER BY created_at ASC, id ASC
      `,
    );

    expect(attendanceChain.rows.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < attendanceChain.rows.length; index += 1) {
      expect(attendanceChain.rows[index]!.previous_hash).toBe(
        attendanceChain.rows[index - 1]!.current_hash,
      );
    }

    await clerk.agent.post('/auth/logout').expect(201);
  });

  it('rejects direct updates and deletes against append-only audit and attendance rows', async () => {
    const clerk = await login('clerk.emma', 'Clerk!2026', 'pos');
    const clockIn = await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .expect(201);

    const auditLog = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM audit_logs
      WHERE entity_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      [clockIn.body.recordId],
    );

    await expect(
      pool.query("UPDATE attendance_records SET event_type = 'CLOCK_OUT' WHERE id = $1", [
        clockIn.body.recordId,
      ]),
    ).rejects.toThrow('attendance_records is append-only');
    await expect(
      pool.query('DELETE FROM attendance_records WHERE id = $1', [clockIn.body.recordId]),
    ).rejects.toThrow('attendance_records is append-only');

    await expect(
      pool.query("UPDATE audit_logs SET action = 'FORGED_ACTION' WHERE id = $1", [auditLog.rows[0]!.id]),
    ).rejects.toThrow('audit_logs is append-only');
    await expect(pool.query('DELETE FROM audit_logs WHERE id = $1', [auditLog.rows[0]!.id])).rejects.toThrow(
      'audit_logs is append-only',
    );

    await clerk.agent
      .post('/attendance/clock-out')
      .field('occurredAt', new Date().toISOString())
      .expect(201);

    await clerk.agent.post('/auth/logout').expect(201);
  });

  it('denies immutable-table mutations and truncation for the runtime application role', async () => {
    const runtimeIdentity = await runtimePool!.query<{ current_user: string }>(
      'SELECT current_user',
    );
    expect(runtimeIdentity.rows[0]!.current_user).not.toBe('postgres');

    const readerId = await findUserId('reader.ada');
    await expect(
      runtimePool!.query('UPDATE users SET display_name = display_name WHERE id = $1', [readerId]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      runtimePool!.query("UPDATE users SET role = 'MANAGER' WHERE id = $1", [readerId]),
    ).rejects.toThrow(/permission denied/i);
    await runtimePool!.query(
      `
      UPDATE users
      SET failed_login_attempts = failed_login_attempts + 1,
          updated_at = NOW()
      WHERE id = $1
      `,
      [readerId],
    );
    await runtimePool!.query(
      `
      UPDATE users
      SET failed_login_attempts = 0,
          locked_until = NULL,
          updated_at = NOW()
      WHERE id = $1
      `,
      [readerId],
    );

    const clerk = await login('clerk.emma', 'Clerk!2026', 'pos');
    const clockIn = await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date().toISOString())
      .expect(201);

    const auditLog = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM audit_logs
      WHERE entity_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `,
      [clockIn.body.recordId],
    );

    await expect(
      runtimePool!.query("UPDATE attendance_records SET event_type = 'CLOCK_OUT' WHERE id = $1", [
        clockIn.body.recordId,
      ]),
    ).rejects.toThrow(/append-only|permission denied|must be owner/i);
    await expect(
      runtimePool!.query('DELETE FROM attendance_records WHERE id = $1', [clockIn.body.recordId]),
    ).rejects.toThrow(/append-only|permission denied|must be owner/i);

    await expect(
      runtimePool!.query("UPDATE audit_logs SET action = 'FORGED_ACTION' WHERE id = $1", [
        auditLog.rows[0]!.id,
      ]),
    ).rejects.toThrow(/append-only|permission denied|must be owner/i);
    await expect(
      runtimePool!.query('DELETE FROM audit_logs WHERE id = $1', [auditLog.rows[0]!.id]),
    ).rejects.toThrow(
      /append-only|permission denied|must be owner/i,
    );
    await expect(runtimePool!.query('TRUNCATE TABLE audit_logs')).rejects.toThrow(
      /permission denied|must be owner/i,
    );
    await expect(runtimePool!.query('TRUNCATE TABLE attendance_records')).rejects.toThrow(
      /permission denied|must be owner/i,
    );
    await expect(
      runtimePool!.query("INSERT INTO schema_migrations (version) VALUES ('runtime-role-probe')"),
    ).rejects.toThrow(/permission denied|must be owner/i);
    await expect(
      runtimePool!.query("DELETE FROM rule_versions WHERE rule_key = 'missing-clock-out' AND version = 1"),
    ).rejects.toThrow(/permission denied|must be owner/i);
    await expect(runtimePool!.query('CREATE TABLE runtime_priv_probe(id integer)')).rejects.toThrow(
      /permission denied|must be owner/i,
    );

    await clerk.agent
      .post('/attendance/clock-out')
      .field('occurredAt', new Date().toISOString())
      .expect(201);
    await clerk.agent.post('/auth/logout').expect(201);
  });

});
