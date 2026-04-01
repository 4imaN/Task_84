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
});
