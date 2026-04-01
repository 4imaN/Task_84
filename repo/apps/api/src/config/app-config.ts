const BANNED_ENCRYPTION_KEYS = new Set(['ledgerread-local-demo-secret']);

export interface AppConfig {
  port: number;
  databaseUrl: string;
  appBaseUrl: string;
  encryptionKey: string;
  sessionTtlMinutes: number;
  evidenceStorageRoot: string;
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

export const loadConfig = (): AppConfig => ({
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ledgerread',
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:4000',
  encryptionKey: requireEncryptionKey(),
  sessionTtlMinutes: Number(process.env.SESSION_TTL_MINUTES ?? 30),
  evidenceStorageRoot: process.env.EVIDENCE_STORAGE_ROOT ?? '/tmp/ledgerread-evidence',
});
