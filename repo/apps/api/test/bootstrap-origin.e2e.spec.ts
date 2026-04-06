import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createBootstrapApp } from '../src/main';

const APP_ORIGIN = process.env.APP_BASE_URL ?? 'http://localhost:4000';
const CONFIGURED_LAN_ORIGIN = 'http://192.168.50.20:4173';
const SAME_HOST_LAN_ORIGIN = 'http://192.168.50.30:4000';
const SAME_HOST_HEADER = '192.168.50.30:4000';

describe('Bootstrap CORS and LAN origin policy', () => {
  let app: INestApplication;
  let originalAllowedOriginsEnv: string | undefined;
  let originalTrustedProxyHopsEnv: string | undefined;

  const applyPreflightHeaders = (
    req: request.Test,
    origin: string,
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    host?: string,
  ) => {
    let next = req
      .set('Origin', origin)
      .set('Access-Control-Request-Method', method)
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');

    if (host) {
      next = next.set('Host', host);
    }

    return next;
  };

  beforeAll(async () => {
    originalAllowedOriginsEnv = process.env.APP_ALLOWED_ORIGINS;
    originalTrustedProxyHopsEnv = process.env.APP_TRUSTED_PROXY_HOPS;
    delete process.env.APP_TRUSTED_PROXY_HOPS;

    const allowedOrigins = new Set(
      (process.env.APP_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    );
    allowedOrigins.add(CONFIGURED_LAN_ORIGIN);
    process.env.APP_ALLOWED_ORIGINS = Array.from(allowedOrigins).join(',');

    const built = await createBootstrapApp();
    app = built.app;
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (originalAllowedOriginsEnv === undefined) {
      delete process.env.APP_ALLOWED_ORIGINS;
    } else {
      process.env.APP_ALLOWED_ORIGINS = originalAllowedOriginsEnv;
    }

    if (originalTrustedProxyHopsEnv === undefined) {
      delete process.env.APP_TRUSTED_PROXY_HOPS;
    } else {
      process.env.APP_TRUSTED_PROXY_HOPS = originalTrustedProxyHopsEnv;
    }
  });

  it('allows localhost and configured LAN origins through the real bootstrap CORS path', async () => {
    const localhostPreflight = await applyPreflightHeaders(
      request(app.getHttpServer()).options('/auth/login'),
      APP_ORIGIN,
      'POST',
    ).expect(204);
    expect(localhostPreflight.headers['access-control-allow-origin']).toBe(APP_ORIGIN);

    const configuredLanPreflight = await applyPreflightHeaders(
      request(app.getHttpServer()).options('/auth/login'),
      CONFIGURED_LAN_ORIGIN,
      'POST',
    ).expect(204);
    expect(configuredLanPreflight.headers['access-control-allow-origin']).toBe(CONFIGURED_LAN_ORIGIN);
  });

  it('allows same-host LAN-style origins through bootstrap CORS and authenticated cookie flow', async () => {
    const sameHostPreflight = await applyPreflightHeaders(
      request(app.getHttpServer()).options('/auth/login'),
      SAME_HOST_LAN_ORIGIN,
      'POST',
      SAME_HOST_HEADER,
    ).expect(204);
    expect(sameHostPreflight.headers['access-control-allow-origin']).toBe(SAME_HOST_LAN_ORIGIN);

    const sessionAgent = request.agent(app.getHttpServer());
    const loginResponse = await sessionAgent
      .post('/auth/login')
      .set('Origin', SAME_HOST_LAN_ORIGIN)
      .set('Host', SAME_HOST_HEADER)
      .send({ username: 'clerk.emma', password: 'Clerk!2026', workspace: 'pos' })
      .expect(201);

    const csrfToken = loginResponse.body.csrfToken as string;
    await sessionAgent
      .post('/attendance/clock-in')
      .set('Origin', SAME_HOST_LAN_ORIGIN)
      .set('Host', SAME_HOST_HEADER)
      .set('x-csrf-token', csrfToken)
      .field('occurredAt', new Date().toISOString())
      .expect(201);

    await sessionAgent
      .post('/auth/logout')
      .set('Origin', SAME_HOST_LAN_ORIGIN)
      .set('Host', SAME_HOST_HEADER)
      .set('x-csrf-token', csrfToken)
      .expect(201);
  });

  it('rejects disallowed origins in bootstrap CORS and login guard flows', async () => {
    const disallowedOrigin = 'http://evil.example';

    const disallowedPreflight = await applyPreflightHeaders(
      request(app.getHttpServer()).options('/auth/login'),
      disallowedOrigin,
      'POST',
    );
    expect([204, 404]).toContain(disallowedPreflight.status);
    expect(disallowedPreflight.headers['access-control-allow-origin']).toBeUndefined();

    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', disallowedOrigin)
      .send({ username: 'reader.ada', password: 'Reader!2026', workspace: 'app' })
      .expect(403)
      .expect(({ body }) => {
        expect(body.message).toBe('Request origin is not allowed for login.');
      });
  });

  it('rejects forged x-forwarded-host values when trusted proxy mode is disabled', async () => {
    const forgedOrigin = SAME_HOST_LAN_ORIGIN;
    const forgedHost = 'localhost:4000';

    const forgedPreflight = await applyPreflightHeaders(
      request(app.getHttpServer()).options('/auth/login'),
      forgedOrigin,
      'POST',
      forgedHost,
    ).set('x-forwarded-host', SAME_HOST_HEADER);
    expect([204, 404]).toContain(forgedPreflight.status);
    expect(forgedPreflight.headers['access-control-allow-origin']).toBeUndefined();

    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', forgedOrigin)
      .set('Host', forgedHost)
      .set('x-forwarded-host', SAME_HOST_HEADER)
      .send({ username: 'reader.ada', password: 'Reader!2026', workspace: 'app' })
      .expect(403)
      .expect(({ body }) => {
        expect(body.message).toBe('Request origin is not allowed for login.');
      });
  });
});

describe('Bootstrap origin policy with explicit trusted proxy configuration', () => {
  let app: INestApplication;
  let originalAllowedOriginsEnv: string | undefined;
  let originalTrustedProxyHopsEnv: string | undefined;

  beforeAll(async () => {
    originalAllowedOriginsEnv = process.env.APP_ALLOWED_ORIGINS;
    originalTrustedProxyHopsEnv = process.env.APP_TRUSTED_PROXY_HOPS;
    process.env.APP_TRUSTED_PROXY_HOPS = '1';

    const allowedOrigins = new Set(
      (process.env.APP_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    );
    allowedOrigins.add(CONFIGURED_LAN_ORIGIN);
    process.env.APP_ALLOWED_ORIGINS = Array.from(allowedOrigins).join(',');

    const built = await createBootstrapApp();
    app = built.app;
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (originalAllowedOriginsEnv === undefined) {
      delete process.env.APP_ALLOWED_ORIGINS;
    } else {
      process.env.APP_ALLOWED_ORIGINS = originalAllowedOriginsEnv;
    }

    if (originalTrustedProxyHopsEnv === undefined) {
      delete process.env.APP_TRUSTED_PROXY_HOPS;
    } else {
      process.env.APP_TRUSTED_PROXY_HOPS = originalTrustedProxyHopsEnv;
    }
  });

  it('accepts forwarded-host same-origin requests only when trusted proxy mode is enabled', async () => {
    const proxyVisibleHost = 'localhost:4000';

    const sameHostPreflight = await request(app.getHttpServer())
      .options('/auth/login')
      .set('Origin', SAME_HOST_LAN_ORIGIN)
      .set('Host', proxyVisibleHost)
      .set('x-forwarded-host', SAME_HOST_HEADER)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token')
      .expect(204);
    expect(sameHostPreflight.headers['access-control-allow-origin']).toBe(SAME_HOST_LAN_ORIGIN);

    const sessionAgent = request.agent(app.getHttpServer());
    const loginResponse = await sessionAgent
      .post('/auth/login')
      .set('Origin', SAME_HOST_LAN_ORIGIN)
      .set('Host', proxyVisibleHost)
      .set('x-forwarded-host', SAME_HOST_HEADER)
      .send({ username: 'clerk.emma', password: 'Clerk!2026', workspace: 'pos' })
      .expect(201);

    await sessionAgent
      .post('/auth/logout')
      .set('Origin', SAME_HOST_LAN_ORIGIN)
      .set('Host', proxyVisibleHost)
      .set('x-forwarded-host', SAME_HOST_HEADER)
      .set('x-csrf-token', loginResponse.body.csrfToken as string)
      .expect(201);
  });
});
