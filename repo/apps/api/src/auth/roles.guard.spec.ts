import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { ALLOWED_ROLES_KEY } from './roles.decorator';
import type { ExecutionContext } from '@nestjs/common';

const buildContext = (user?: { role: string }) => {
  const req: Record<string, unknown> = { user };

  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
};

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as never);
  });

  it('allows access when no roles are configured on the handler', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('allows access when the roles array is empty', () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('allows access when the user role is in the allowed list', () => {
    reflector.getAllAndOverride.mockReturnValue(['MANAGER', 'FINANCE']);
    expect(guard.canActivate(buildContext({ role: 'MANAGER' }))).toBe(true);
  });

  it('rejects access when the user role is not in the allowed list', () => {
    reflector.getAllAndOverride.mockReturnValue(['MANAGER', 'FINANCE']);
    const ctx = buildContext({ role: 'CUSTOMER' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('This route is restricted to a different role.');
  });

  it('rejects access when no user is attached to the request', () => {
    reflector.getAllAndOverride.mockReturnValue(['MANAGER']);
    const ctx = buildContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('reads roles metadata with the correct key', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = buildContext();
    guard.canActivate(ctx);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      ALLOWED_ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
  });
});
