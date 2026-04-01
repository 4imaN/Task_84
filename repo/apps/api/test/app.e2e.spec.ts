import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  createIdentifierLookupHash,
  decryptAtRestValue,
  encryptAtRestValue,
} from '../src/security/identifier';

const GRAPHQL = '/graphql';
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

describe('LedgerRead API', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof request>;
  let pool: Pool;

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

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ledgerread',
    });

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
    await pool.end();
  });

  const login = async (username: string, password: string, workspace: string) => {
    const sessionAgent = request.agent(app.getHttpServer());
    const response = await sessionAgent.post('/auth/login').send({ username, password, workspace }).expect(201);
    return {
      agent: sessionAgent,
      user: response.body.user as { id: string; username: string; role: string; workspace: string },
      homePath: response.body.homePath as string,
    } satisfies {
      agent: ReturnType<typeof request.agent>;
      user: { id: string; username: string; role: string; workspace: string };
      homePath: string;
    };
  };

  const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

  const graphql = async <T = unknown>(
    sessionAgent: ReturnType<typeof request.agent>,
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

  it('rejects unauthenticated session access with 401', async () => {
    await agent.get('/auth/session').expect(401);
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
        .send({ username: 'inventory.ivan', password: 'Wrong!Password1', workspace: 'admin' })
        .expect(401);
    }

    await agent
      .post('/auth/login')
      .send({ username: 'inventory.ivan', password: 'Inventory!2026', workspace: 'admin' })
      .expect(401);

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
    await agent.get('/auth/session').set(authHeader('invalid-token')).expect(401);
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

  it('rejects malformed identifiers and invalid admin intake payloads with 400 responses', async () => {
    const customer = await login('reader.ada', 'Reader!2026', 'app');

    await customer.agent
      .post('/community/comments')
      .send({
        titleId: 'not-a-uuid',
        commentType: 'COMMENT',
        body: 'Validation should reject malformed title IDs before Postgres sees them.',
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
    await manager.agent.post('/auth/logout').expect(201);
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
      ORDER BY created_at DESC
      LIMIT 2
      `,
      [clerk.user.id],
    );
    expect(clerkAttendance.rows.map((row) => row.event_type)).toEqual(['CLOCK_OUT', 'CLOCK_IN']);

    await pool.query(
      `
      DELETE FROM risk_alerts
      WHERE attendance_record_id IN (
        SELECT id
        FROM attendance_records
        WHERE user_id = $1
      )
      `,
      [clerk.user.id],
    );
    await pool.query('DELETE FROM attendance_records WHERE user_id = $1', [clerk.user.id]);

    await clerk.agent.post('/auth/logout').expect(201);
  });

  it('runs the customer flow with profile isolation, masking, sync conflicts, and trace logging', async () => {
    const customer = await login('reader.ada', 'Reader!2026', 'app');
    const otherCustomerId = await findUserId('reader.mei');
    const title = await pool.query<{ id: string; author_id: string; series_id: string | null }>(
      "SELECT id, author_id, series_id FROM titles WHERE slug = 'quiet-harbor-digital'",
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
      catalog: { featured: Array<{ id: string; name: string }>; bestSellers: Array<{ id: string; name: string }> };
    }>(customer.agent, 'query { catalog { featured { id name } bestSellers { id name } } }');
    expect(catalog.catalog.featured.length).toBeGreaterThan(0);

    const titleResponse = await graphql<{
      title: { id: string; name: string; chapters: Array<{ id: string; name: string; body: string }> };
    }>(
      customer.agent,
      'query ($id: String!) { title(id: $id) { id name chapters { id name body } } }',
      { id: title.rows[0]!.id },
    );
    expect(titleResponse.title.chapters.length).toBeGreaterThan(0);

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
      ORDER BY created_at DESC
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
      .expect(409);

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
      .attach('evidence', Buffer.from('not-an-image'), {
        filename: 'bad.txt',
        contentType: 'text/plain',
      })
      .expect(400);

    await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString())
      .field('expectedChecksum', 'expected-but-wrong')
      .attach('evidence', Buffer.from('png-like-binary'), { filename: 'proof.png', contentType: 'image/png' })
      .expect(400);

    await clerk.agent
      .post('/attendance/clock-in')
      .field('occurredAt', new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString())
      .field('expectedChecksum', 'expected-but-wrong')
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
      ORDER BY created_at DESC
      LIMIT 1
      `,
    );
    expect(latestEvidence.rows[0]!.evidence_path.startsWith('/tmp/ledgerread-evidence')).toBe(true);
    expect(latestEvidence.rows[0]!.evidence_path.includes('..')).toBe(false);

    const risks = await clerk.agent.get('/attendance/risks').expect(200);
    expect(
      risks.body.some((risk: { description: string }) => risk.description.includes('Missing clock-out')),
    ).toBe(true);
    expect(
      risks.body.some((risk: { description: string }) => risk.description.includes('checksum mismatch')),
    ).toBe(true);

    await clerk.agent
      .post('/attendance/clock-out')
      .field('occurredAt', new Date().toISOString())
      .expect(201);

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
      ORDER BY created_at ASC
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
});
