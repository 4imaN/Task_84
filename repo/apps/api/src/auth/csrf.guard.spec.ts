import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';
import { CsrfService } from './csrf.service';
import { AUTH_COOKIE_NAME, CSRF_HEADER_NAME } from './auth.constants';

const buildContext = (overrides: {
  method?: string;
  path?: string;
  headers?: Record<string, string | undefined>;
  cookie?: string;
}): ExecutionContext => {
  const req = {
    method: overrides.method ?? 'POST',
    path: overrides.path ?? '/some-endpoint',
    headers: {
      ...(overrides.headers ?? {}),
      cookie: overrides.cookie,
    },
  };

  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
};

describe('CsrfGuard', () => {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'allowedOrigins') return ['http://localhost:4000'];
      if (key === 'trustedProxyHops') return 0;
      return undefined;
    }),
  };

  const csrfService: jest.Mocked<Pick<CsrfService, 'validateToken'>> = {
    validateToken: jest.fn(),
  };

  let guard: CsrfGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new CsrfGuard(configService as never, csrfService as never);
  });

  it('allows safe methods (GET, HEAD, OPTIONS) unconditionally', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const ctx = buildContext({ method });
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('allows POST /auth/login when origin is in the allowlist', () => {
    const ctx = buildContext({
      method: 'POST',
      path: '/auth/login',
      headers: { origin: 'http://localhost:4000' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects POST /auth/login when origin header is missing', () => {
    const ctx = buildContext({
      method: 'POST',
      path: '/auth/login',
      headers: {},
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Request origin is required for login.');
  });

  it('rejects POST /auth/login when origin is disallowed', () => {
    const ctx = buildContext({
      method: 'POST',
      path: '/auth/login',
      headers: { origin: 'http://evil.example' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Request origin is not allowed for login.');
  });

  it('allows unsafe mutations without session cookie (no CSRF needed)', () => {
    const ctx = buildContext({
      method: 'POST',
      headers: { origin: 'http://localhost:4000' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects authenticated mutations when CSRF token is missing', () => {
    const ctx = buildContext({
      method: 'POST',
      cookie: `${AUTH_COOKIE_NAME}=session-token-123`,
      headers: { origin: 'http://localhost:4000' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('CSRF protection token is missing or invalid.');
  });

  it('rejects authenticated mutations when CSRF token is invalid', () => {
    csrfService.validateToken.mockReturnValue(false);
    const ctx = buildContext({
      method: 'POST',
      cookie: `${AUTH_COOKIE_NAME}=session-token-123`,
      headers: {
        origin: 'http://localhost:4000',
        [CSRF_HEADER_NAME]: 'bad-token',
      },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('CSRF protection token is missing or invalid.');
  });

  it('allows authenticated mutations when CSRF token is valid and origin is allowed', () => {
    csrfService.validateToken.mockReturnValue(true);
    const ctx = buildContext({
      method: 'POST',
      cookie: `${AUTH_COOKIE_NAME}=session-token-123`,
      headers: {
        origin: 'http://localhost:4000',
        [CSRF_HEADER_NAME]: 'valid-nonce.valid-sig',
      },
    });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(csrfService.validateToken).toHaveBeenCalledWith('session-token-123', 'valid-nonce.valid-sig');
  });

  it('rejects authenticated mutations from a disallowed origin even with valid CSRF', () => {
    csrfService.validateToken.mockReturnValue(true);
    const ctx = buildContext({
      method: 'POST',
      cookie: `${AUTH_COOKIE_NAME}=session-token-123`,
      headers: {
        origin: 'http://evil.example',
        [CSRF_HEADER_NAME]: 'valid-nonce.valid-sig',
      },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Request origin is not allowed for authenticated mutations.');
  });

  it('falls back to referer header when origin is absent on login', () => {
    const ctx = buildContext({
      method: 'POST',
      path: '/auth/login',
      headers: { referer: 'http://localhost:4000/login?next=%2Fapp' },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects login when referer is malformed', () => {
    const ctx = buildContext({
      method: 'POST',
      path: '/auth/login',
      headers: { referer: 'not-a-url' },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Request referer is malformed for login.');
  });
});
