import { UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AUTH_COOKIE_NAME } from './auth.constants';
import type { ExecutionContext } from '@nestjs/common';

const buildContext = (cookie?: string) => {
  const req: Record<string, unknown> = {
    headers: { cookie },
  };

  return {
    context: {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext,
    req,
  };
};

describe('AuthGuard', () => {
  const authService = {
    getSessionUser: jest.fn(),
  };

  let guard: AuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new AuthGuard(authService as never);
  });

  it('throws UnauthorizedException when no session cookie is present', async () => {
    const { context } = buildContext(undefined);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(context)).rejects.toThrow('Authentication is required.');
  });

  it('throws UnauthorizedException when the cookie header is empty', async () => {
    const { context } = buildContext('');
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('resolves the session user and attaches it to the request', async () => {
    const user = { id: 'u-1', username: 'reader.ada', role: 'CUSTOMER' };
    authService.getSessionUser.mockResolvedValue(user);
    const { context, req } = buildContext(`${AUTH_COOKIE_NAME}=valid-token`);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(authService.getSessionUser).toHaveBeenCalledWith('valid-token', undefined);
    expect(req.user).toBe(user);
    expect(req.token).toBe('valid-token');
  });

  it('propagates the traceId to getSessionUser', async () => {
    const user = { id: 'u-1', username: 'reader.ada', role: 'CUSTOMER' };
    authService.getSessionUser.mockResolvedValue(user);
    const { context, req } = buildContext(`${AUTH_COOKIE_NAME}=token-2`);
    (req as Record<string, unknown>).traceId = 'trace-abc';

    await guard.canActivate(context);
    expect(authService.getSessionUser).toHaveBeenCalledWith('token-2', 'trace-abc');
  });

  it('propagates service errors (e.g. expired/invalid session)', async () => {
    authService.getSessionUser.mockRejectedValue(new UnauthorizedException('Session expired.'));
    const { context } = buildContext(`${AUTH_COOKIE_NAME}=expired-token`);
    await expect(guard.canActivate(context)).rejects.toThrow('Session expired.');
  });
});
