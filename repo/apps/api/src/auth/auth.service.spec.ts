import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';

jest.mock('argon2', () => ({
  verify: jest.fn(),
}));

const mockArgon2 = argon2 as jest.Mocked<typeof argon2>;
const queryResult = <T>(rows: T[]) => ({ rows });

describe('AuthService', () => {
  const databaseService = {
    query: jest.fn(),
  };
  const securityService = {
    generateOpaqueToken: jest.fn(() => 'opaque-token'),
    hashToken: jest.fn((value: string) => `hashed-${value}`),
    hashLookup: jest.fn((value: string) => `lookup-${value}`),
    decryptAtRest: jest.fn((value: string) =>
      value === 'cipher-reader'
        ? 'reader.ada'
        : value === 'cipher-finance'
          ? 'finance.zoe'
          : 'inventory.ivan',
    ),
  };
  const configService = {
    get: jest.fn(() => 30),
  };

  let service: AuthService;
  let warnSpy: jest.Mock;
  let logSpy: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      databaseService as never,
      securityService as never,
      configService as never,
    );
    warnSpy = jest.fn();
    logSpy = jest.fn();
    (service as any).logger = {
      warn: warnSpy,
      log: logSpy,
    };
  });

  it('locks the account after the fifth failed login attempt', async () => {
    databaseService.query
      .mockResolvedValueOnce(
        queryResult([
          {
            id: 'user-1',
            username: null,
            username_cipher: 'cipher-inventory',
            display_name: 'Ivan',
            role: 'INVENTORY_MANAGER',
            password_hash: 'hash',
            is_suspended: false,
            failed_login_attempts: 4,
            locked_until: null,
          },
        ]),
      )
      .mockResolvedValueOnce(queryResult([]));
    mockArgon2.verify.mockResolvedValue(false);

    await expect(service.login('inventory.ivan', 'wrong', 'admin')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(databaseService.query).toHaveBeenLastCalledWith(
      expect.stringContaining('failed_login_attempts'),
      ['user-1'],
    );
  });

  it('starts a fresh failure window after lockout expiry without immediate relock', async () => {
    databaseService.query
      .mockResolvedValueOnce(
        queryResult([
          {
            id: 'user-1',
            username: null,
            username_cipher: 'cipher-inventory',
            display_name: 'Ivan',
            role: 'INVENTORY_MANAGER',
            password_hash: 'hash',
            is_suspended: false,
            failed_login_attempts: 5,
            locked_until: new Date(Date.now() - 60_000).toISOString(),
          },
        ]),
      );
    mockArgon2.verify.mockResolvedValue(false);

    await expect(service.login('inventory.ivan', 'wrong', 'admin')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(databaseService.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHEN locked_until IS NOT NULL AND locked_until <= NOW() THEN 1'),
      ['user-1'],
    );
  });

  it('counts password-policy violations as failed attempts before password hash verification', async () => {
    databaseService.query
      .mockResolvedValueOnce(
        queryResult([
          {
            id: 'user-1',
            username: null,
            username_cipher: 'cipher-inventory',
            display_name: 'Ivan',
            role: 'INVENTORY_MANAGER',
            password_hash: 'hash',
            is_suspended: false,
            failed_login_attempts: 0,
            locked_until: null,
          },
        ]),
      )
      .mockResolvedValueOnce(queryResult([]));

    await expect(service.login('inventory.ivan', 'short', 'admin')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(mockArgon2.verify).not.toHaveBeenCalled();
    expect(databaseService.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('failed_login_attempts'),
      ['user-1'],
    );
  });

  it('rejects workspace mismatch even with a valid password', async () => {
    databaseService.query.mockResolvedValueOnce(
      queryResult([
        {
          id: 'user-1',
          username: null,
          username_cipher: 'cipher-reader',
          display_name: 'Ada',
          role: 'CUSTOMER',
          password_hash: 'hash',
          is_suspended: false,
          failed_login_attempts: 0,
          locked_until: null,
        },
      ]),
    );
    mockArgon2.verify.mockResolvedValue(true);

    await expect(service.login('reader.ada', 'Reader!2026', 'admin')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('expires idle sessions and removes them from storage', async () => {
    databaseService.query
      .mockResolvedValueOnce(
        queryResult([
          {
            id: 'user-2',
            username: null,
            username_cipher: 'cipher-finance',
            role: 'FINANCE',
            workspace: 'admin',
            display_name: 'Zoe',
            is_suspended: false,
            token_hash: 'hashed-token',
            last_activity_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
            expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
          },
        ]),
      )
      .mockResolvedValueOnce(queryResult([]));

    await expect(service.getSessionUser('token')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(databaseService.query).toHaveBeenLastCalledWith(
      'DELETE FROM sessions WHERE token_hash = $1',
      ['hashed-token'],
    );
  });

  it('normalizes legacy finance sessions into the finance workspace', async () => {
    databaseService.query
      .mockResolvedValueOnce(
        queryResult([
          {
            id: 'user-2',
            username: null,
            username_cipher: 'cipher-finance',
            role: 'FINANCE',
            workspace: 'admin',
            display_name: 'Zoe',
            is_suspended: false,
            token_hash: 'hashed-token',
            last_activity_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
            expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          },
        ]),
      )
      .mockResolvedValueOnce(queryResult([]));

    await expect(service.getSessionUser('token')).resolves.toMatchObject({
      role: 'FINANCE',
      workspace: 'finance',
    });
    expect(databaseService.query).toHaveBeenLastCalledWith(
      expect.stringContaining('workspace = $3'),
      ['hashed-token', expect.any(String), 'finance'],
    );
  });

  it('redacts plaintext usernames from auth warning logs', async () => {
    databaseService.query.mockResolvedValueOnce(queryResult([]));

    await expect(service.login('reader.ada', 'wrong', 'app', 'trace-auth-1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const emitted = warnSpy.mock.calls.flat().join(' ');
    expect(emitted).toContain('AUTH_LOGIN_FAILED');
    expect(emitted).toContain('traceId=trace-auth-1');
    expect(emitted).not.toContain('reader.ada');
  });

  it('redacts plaintext usernames from auth info logs while keeping internal ids', async () => {
    databaseService.query
      .mockResolvedValueOnce(
        queryResult([
          {
            id: 'user-1',
            username: null,
            username_cipher: 'cipher-reader',
            display_name: 'Ada',
            role: 'CUSTOMER',
            password_hash: 'hash',
            is_suspended: false,
            failed_login_attempts: 0,
            locked_until: null,
          },
        ]),
      )
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]));
    mockArgon2.verify.mockResolvedValue(true);

    await expect(service.login('reader.ada', 'Reader!2026', 'app', 'trace-auth-2')).resolves.toMatchObject({
      user: { id: 'user-1' },
    });

    const emitted = logSpy.mock.calls.flat().join(' ');
    expect(emitted).toContain('AUTH_SESSION_ISSUED');
    expect(emitted).toContain('userId=user-1');
    expect(emitted).toContain('traceId=trace-auth-2');
    expect(emitted).not.toContain('reader.ada');
  });
});
