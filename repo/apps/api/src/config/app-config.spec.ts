describe('loadConfig', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('fails when APP_ENCRYPTION_KEY is missing', async () => {
    delete process.env.APP_ENCRYPTION_KEY;
    const { loadConfig } = await import('./app-config');
    expect(() => loadConfig()).toThrow('APP_ENCRYPTION_KEY is required at startup.');
  });

  it('fails when APP_ENCRYPTION_KEY uses the banned demo secret', async () => {
    process.env.APP_ENCRYPTION_KEY = 'ledgerread-local-demo-secret';
    const { loadConfig } = await import('./app-config');
    expect(() => loadConfig()).toThrow('APP_ENCRYPTION_KEY uses a banned demo secret and must be rotated.');
  });

  it('accepts a supplied non-default encryption key', async () => {
    process.env.APP_ENCRYPTION_KEY = 'review-safe-encryption-key-2026';
    const { loadConfig } = await import('./app-config');
    expect(loadConfig().encryptionKey).toBe('review-safe-encryption-key-2026');
  });

  it('applies the explicit attendance evidence upload limit from configuration', async () => {
    process.env.APP_ENCRYPTION_KEY = 'review-safe-encryption-key-2026';
    process.env.ATTENDANCE_EVIDENCE_MAX_BYTES = '1048576';
    const { loadConfig } = await import('./app-config');
    expect(loadConfig().evidenceUploadMaxBytes).toBe(1048576);
  });

  it('applies the explicit attendance client clock skew window from configuration', async () => {
    process.env.APP_ENCRYPTION_KEY = 'review-safe-encryption-key-2026';
    process.env.ATTENDANCE_CLIENT_CLOCK_SKEW_SECONDS = '120';
    const { loadConfig } = await import('./app-config');
    expect(loadConfig().attendanceClientClockSkewSeconds).toBe(120);
  });

  it('rejects postgres superuser runtime URLs in production mode', async () => {
    process.env.APP_ENCRYPTION_KEY = 'review-safe-encryption-key-2026';
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ledgerread';
    const { loadConfig } = await import('./app-config');
    expect(() => loadConfig()).toThrow(
      'Production runtime must not use the postgres superuser. Configure DATABASE_URL with a least-privileged app role.',
    );
  });

  it('rejects postgres superuser runtime URLs outside production mode by default', async () => {
    process.env.APP_ENCRYPTION_KEY = 'review-safe-encryption-key-2026';
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ledgerread';
    delete process.env.LEDGERREAD_ALLOW_SUPERUSER_RUNTIME;
    const { loadConfig } = await import('./app-config');
    expect(() => loadConfig()).toThrow(
      'Runtime must not use the postgres superuser by default. Configure DATABASE_URL with a least-privileged app role, or set LEDGERREAD_ALLOW_SUPERUSER_RUNTIME=1 for explicit local development overrides.',
    );
  });

  it('allows an explicit local superuser override outside production mode', async () => {
    process.env.APP_ENCRYPTION_KEY = 'review-safe-encryption-key-2026';
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ledgerread';
    process.env.LEDGERREAD_ALLOW_SUPERUSER_RUNTIME = '1';
    const { loadConfig } = await import('./app-config');
    expect(loadConfig().databaseUrl).toBe('postgresql://postgres:postgres@localhost:5432/ledgerread');
  });

  it('accepts least-privileged runtime database URLs in production mode', async () => {
    process.env.APP_ENCRYPTION_KEY = 'review-safe-encryption-key-2026';
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://ledgerread_app:ledgerread_app@localhost:5432/ledgerread';
    const { loadConfig } = await import('./app-config');
    expect(loadConfig().databaseUrl).toBe(
      'postgresql://ledgerread_app:ledgerread_app@localhost:5432/ledgerread',
    );
  });

  it('adds configured LAN origins to the browser allowlist', async () => {
    process.env.APP_ENCRYPTION_KEY = 'review-safe-encryption-key-2026';
    process.env.APP_ALLOWED_ORIGINS = 'http://192.168.1.50:4173, http://ledgerread.local:4173';
    const { loadConfig } = await import('./app-config');
    const config = loadConfig();

    expect(config.allowedOrigins).toEqual(
      expect.arrayContaining([
        'http://localhost:4000',
        'http://localhost:4173',
        'http://127.0.0.1:4173',
        'http://192.168.1.50:4173',
        'http://ledgerread.local:4173',
      ]),
    );
  });

  it('fails when APP_ALLOWED_ORIGINS includes malformed entries', async () => {
    process.env.APP_ENCRYPTION_KEY = 'review-safe-encryption-key-2026';
    process.env.APP_ALLOWED_ORIGINS = 'not-a-valid-origin';
    const { loadConfig } = await import('./app-config');
    expect(() => loadConfig()).toThrow(
      'APP_ALLOWED_ORIGINS contains an invalid origin: "not-a-valid-origin".',
    );
  });

  it('defaults to disabling trusted proxy forwarded-host behavior', async () => {
    process.env.APP_ENCRYPTION_KEY = 'review-safe-encryption-key-2026';
    delete process.env.APP_TRUSTED_PROXY_HOPS;
    const { loadConfig } = await import('./app-config');
    expect(loadConfig().trustedProxyHops).toBe(0);
  });

  it('accepts explicit trusted proxy hop counts', async () => {
    process.env.APP_ENCRYPTION_KEY = 'review-safe-encryption-key-2026';
    process.env.APP_TRUSTED_PROXY_HOPS = '1';
    const { loadConfig } = await import('./app-config');
    expect(loadConfig().trustedProxyHops).toBe(1);
  });

  it('rejects invalid APP_TRUSTED_PROXY_HOPS values', async () => {
    process.env.APP_ENCRYPTION_KEY = 'review-safe-encryption-key-2026';
    process.env.APP_TRUSTED_PROXY_HOPS = '-1';
    const { loadConfig } = await import('./app-config');
    expect(() => loadConfig()).toThrow('APP_TRUSTED_PROXY_HOPS must be a non-negative integer.');
  });
});
