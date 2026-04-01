import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import type { SessionUser, Workspace } from '@ledgerread/contracts';
import { workspaceRoleMap } from '@ledgerread/contracts';
import type { AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import { SecurityService } from '../security/security.service';
import type { AuthenticatedUserRecord, SessionRecord } from './auth.types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly securityService: SecurityService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  private get sessionTtlMinutes() {
    return this.configService.get('sessionTtlMinutes', { infer: true });
  }

  private resolveStoredUsername(row: { username_cipher?: string | null; username?: string | null }) {
    if (row.username_cipher) {
      return this.securityService.decryptAtRest(row.username_cipher);
    }

    if (row.username) {
      return row.username;
    }

    throw new UnauthorizedException('User identifier could not be resolved.');
  }

  private async findUser(username: string) {
    const result = await this.databaseService.query<{
      id: string;
      username: string | null;
      username_cipher: string | null;
      display_name: string;
      role: AuthenticatedUserRecord['role'];
      password_hash: string;
      is_suspended: boolean;
      failed_login_attempts: number;
      locked_until: string | null;
    }>(
      `
      SELECT id,
             username,
             username_cipher,
             display_name,
             role,
             password_hash,
             is_suspended,
             failed_login_attempts,
             locked_until
      FROM users
      WHERE username_lookup_hash = $1 OR username = $2
      `,
      [this.securityService.hashLookup(username), username],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      ...row,
      username: this.resolveStoredUsername(row),
    };
  }

  private async registerFailedAttempt(userId: string, currentAttempts: number) {
    const failedAttempts = currentAttempts + 1;
    const lockoutWindow = failedAttempts >= 5 ? "NOW() + INTERVAL '15 minutes'" : 'NULL';

    await this.databaseService.query(
      `
      UPDATE users
      SET failed_login_attempts = $2,
          locked_until = ${lockoutWindow},
          updated_at = NOW()
      WHERE id = $1
      `,
      [userId, failedAttempts],
    );
  }

  private async resetFailedAttempts(userId: string) {
    await this.databaseService.query(
      `
      UPDATE users
      SET failed_login_attempts = 0,
          locked_until = NULL,
          updated_at = NOW()
      WHERE id = $1
      `,
      [userId],
    );
  }

  private ensureWorkspaceRole(role: AuthenticatedUserRecord['role'], workspace: Workspace) {
    const allowedRoles = workspaceRoleMap[workspace];
    if (!allowedRoles.includes(role)) {
      throw new ForbiddenException('The requested workspace does not allow this role.');
    }
  }

  private writeAuthLog(
    level: 'log' | 'warn',
    event: string,
    context: Record<string, string | number | undefined>,
  ) {
    const details = Object.entries(context)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    this.logger[level](`AUTH_${event}${details ? ` ${details}` : ''}`);
  }

  async login(username: string, password: string, workspace: Workspace, traceId?: string) {
    const user = await this.findUser(username);
    if (!user) {
      this.writeAuthLog('warn', 'LOGIN_FAILED', {
        traceId,
        workspace,
        reason: 'unknown_account',
      });
      throw new UnauthorizedException('Invalid username or password.');
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      this.writeAuthLog('warn', 'LOGIN_BLOCKED', {
        traceId,
        userId: user.id,
        workspace,
        reason: 'locked',
      });
      throw new UnauthorizedException('The account is temporarily locked.');
    }

    if (user.is_suspended) {
      this.writeAuthLog('warn', 'LOGIN_BLOCKED', {
        traceId,
        userId: user.id,
        workspace,
        reason: 'suspended',
      });
      throw new ForbiddenException('This account is suspended.');
    }

    const isValidPassword = await argon2.verify(user.password_hash, password);
    if (!isValidPassword) {
      await this.registerFailedAttempt(user.id, user.failed_login_attempts);
      this.writeAuthLog('warn', 'LOGIN_FAILED', {
        traceId,
        userId: user.id,
        workspace,
        reason: 'invalid_password',
      });
      throw new UnauthorizedException('Invalid username or password.');
    }

    this.ensureWorkspaceRole(user.role, workspace);
    await this.resetFailedAttempts(user.id);

    const token = this.securityService.generateOpaqueToken();
    const tokenHash = this.securityService.hashToken(token);
    const expiry = new Date(Date.now() + this.sessionTtlMinutes * 60 * 1000);

    await this.databaseService.query(
      `
      INSERT INTO sessions (user_id, token_hash, workspace, last_activity_at, expires_at)
      VALUES ($1, $2, $3, NOW(), $4)
      `,
      [user.id, tokenHash, workspace, expiry.toISOString()],
    );

    this.writeAuthLog('log', 'SESSION_ISSUED', {
      traceId,
      userId: user.id,
      workspace,
    });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        workspace,
      } satisfies SessionUser,
      homePath:
        workspace === 'app'
          ? '/app/library'
          : workspace === 'pos'
            ? '/pos/checkout'
            : workspace === 'mod'
              ? '/mod/queue'
              : workspace === 'finance'
                ? '/finance/settlements'
                : '/admin/overview',
    };
  }

  async logout(token: string) {
    await this.databaseService.query('DELETE FROM sessions WHERE token_hash = $1', [
      this.securityService.hashToken(token),
    ]);
  }

  async getSessionUser(token: string, traceId?: string) {
    const result = await this.databaseService.query<{
      id: string;
      username: string | null;
      username_cipher: string | null;
      role: SessionRecord['role'];
      workspace: SessionRecord['workspace'];
      display_name: string;
      is_suspended: boolean;
      token_hash: string;
      last_activity_at: string;
      expires_at: string;
    }>(
      `
      SELECT users.id,
             users.username,
             users.username_cipher,
             users.role,
             users.display_name,
             users.is_suspended,
             sessions.workspace,
             sessions.token_hash,
             sessions.last_activity_at,
             sessions.expires_at
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = $1
      `,
      [this.securityService.hashToken(token)],
    );

    const row = result.rows[0];
    if (!row) {
      this.writeAuthLog('warn', 'SESSION_LOOKUP_FAILED', {
        traceId,
        reason: 'missing_token',
      });
      throw new UnauthorizedException('Authentication is required.');
    }

    const username = this.resolveStoredUsername(row);
    const now = Date.now();
    const isExpired =
      new Date(row.expires_at).getTime() <= now || new Date(row.last_activity_at).getTime() + this.sessionTtlMinutes * 60 * 1000 <= now;

    if (row.is_suspended || isExpired) {
      await this.logout(token);
      this.writeAuthLog('warn', 'SESSION_REJECTED', {
        traceId,
        userId: row.id,
        workspace: row.workspace,
        reason: row.is_suspended ? 'suspended' : 'expired',
      });
      throw new UnauthorizedException('The session has expired.');
    }

    const nextExpiry = new Date(now + this.sessionTtlMinutes * 60 * 1000).toISOString();
    const normalizedWorkspace =
      row.role === 'FINANCE' && row.workspace === 'admin' ? 'finance' : row.workspace;

    await this.databaseService.query(
      `
      UPDATE sessions
      SET last_activity_at = NOW(),
          expires_at = $2,
          workspace = $3
      WHERE token_hash = $1
      `,
      [row.token_hash, nextExpiry, normalizedWorkspace],
    );

    return {
      id: row.id,
      username,
      role: row.role,
      workspace: normalizedWorkspace,
    } satisfies SessionUser;
  }
}
