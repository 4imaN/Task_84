import { buildAllowedOrigins, parseConfiguredOrigins } from '../common/allowed-origins';

const BANNED_ENCRYPTION_KEYS = new Set(['ledgerread-local-demo-secret']);
export const DEFAULT_ATTENDANCE_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_ATTENDANCE_CLIENT_CLOCK_SKEW_SECONDS = 5 * 60;
const DEFAULT_RUNTIME_DATABASE_URL = 'postgresql://ledgerread_app:ledgerread_app@localhost:5432/ledgerread';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  appBaseUrl: string;
  allowedOrigins: string[];
  trustedProxyHops: number;
  encryptionKey: string;
  sessionTtlMinutes: number;
  evidenceStorageRoot: string;
  evidenceUploadMaxBytes: number;
  attendanceClientClockSkewSeconds: number;
}

const requireEncryptionKey = () => {
  const value = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!value) {
    throw new Error('APP_ENCRYPTION_KEY is required at startup.');
  }

  if (BANNED_ENCRYPTION_KEYS.has(value)) {
    throw new Error('APP_ENCRYPTION_KEY uses a banned demo secret and must be rotated.');
  }

  return value;
};

const validateRuntimeDatabaseUrl = (databaseUrl: string) => {
  try {
    const parsed = new URL(databaseUrl);
    const runtimeRole = decodeURIComponent(parsed.username);
    if (runtimeRole !== 'postgres') {
      return databaseUrl;
    }

    const allowSuperuserRuntime =
      process.env.LEDGERREAD_ALLOW_SUPERUSER_RUNTIME === '1' &&
      (process.env.NODE_ENV ?? 'development') !== 'production';
    if (allowSuperuserRuntime) {
      return databaseUrl;
    }

    if ((process.env.NODE_ENV ?? 'development') === 'production') {
      throw new Error(
        'Production runtime must not use the postgres superuser. Configure DATABASE_URL with a least-privileged app role.',
      );
    }

    throw new Error(
      'Runtime must not use the postgres superuser by default. Configure DATABASE_URL with a least-privileged app role, or set LEDGERREAD_ALLOW_SUPERUSER_RUNTIME=1 for explicit local development overrides.',
    );
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error('DATABASE_URL is invalid.');
  }

  return databaseUrl;
};

const parseTrustedProxyHops = () => {
  const rawValue = process.env.APP_TRUSTED_PROXY_HOPS?.trim();
  if (!rawValue) {
    return 0;
  }

  const hops = Number(rawValue);
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error('APP_TRUSTED_PROXY_HOPS must be a non-negative integer.');
  }

  return hops;
};

export const loadConfig = (): AppConfig => ({
  ...((): Pick<AppConfig, 'appBaseUrl' | 'allowedOrigins'> => {
    const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:4000';
    const configuredOrigins = parseConfiguredOrigins(process.env.APP_ALLOWED_ORIGINS);

    return {
      appBaseUrl,
      allowedOrigins: buildAllowedOrigins(appBaseUrl, configuredOrigins),
    };
  })(),
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: validateRuntimeDatabaseUrl(
    process.env.DATABASE_URL ?? DEFAULT_RUNTIME_DATABASE_URL,
  ),
  trustedProxyHops: parseTrustedProxyHops(),
  encryptionKey: requireEncryptionKey(),
  sessionTtlMinutes: Number(process.env.SESSION_TTL_MINUTES ?? 30),
  evidenceStorageRoot: process.env.EVIDENCE_STORAGE_ROOT ?? '/tmp/ledgerread-evidence',
  evidenceUploadMaxBytes: Number(
    process.env.ATTENDANCE_EVIDENCE_MAX_BYTES ?? DEFAULT_ATTENDANCE_EVIDENCE_MAX_BYTES,
  ),
  attendanceClientClockSkewSeconds: Number(
    process.env.ATTENDANCE_CLIENT_CLOCK_SKEW_SECONDS ??
      DEFAULT_ATTENDANCE_CLIENT_CLOCK_SKEW_SECONDS,
  ),
});
