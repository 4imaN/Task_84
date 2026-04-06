import {
  buildAllowedOrigins,
  isAllowedMutationOrigin,
  parseConfiguredOrigins,
} from './allowed-origins';

describe('allowed origins', () => {
  it('builds a deduplicated origin allowlist with defaults and configured entries', () => {
    const configured = parseConfiguredOrigins(
      'http://192.168.1.50:4173, http://ledgerread.local:4173, http://localhost:4173',
    );

    const allowlist = buildAllowedOrigins('http://localhost:4000', configured);
    expect(allowlist).toEqual(
      expect.arrayContaining([
        'http://localhost:4000',
        'http://localhost:4173',
        'http://127.0.0.1:4173',
        'http://192.168.1.50:4173',
        'http://ledgerread.local:4173',
      ]),
    );
    expect(allowlist.filter((origin) => origin === 'http://localhost:4173')).toHaveLength(1);
  });

  it('allows same-host LAN origins for cookie-authenticated mutations', () => {
    const allowedOrigins = new Set(['http://localhost:4000']);
    const allowed = isAllowedMutationOrigin('http://192.168.10.12:4000', allowedOrigins, {
      host: '192.168.10.12:4000',
    });
    expect(allowed).toBe(true);
  });

  it('rejects unrelated origins when they are neither configured nor same-host', () => {
    const allowedOrigins = new Set(['http://localhost:4000']);
    const allowed = isAllowedMutationOrigin('http://evil.example', allowedOrigins, {
      host: '192.168.10.12:4000',
    });
    expect(allowed).toBe(false);
  });

  it('ignores forged x-forwarded-host values when trusted proxy mode is disabled', () => {
    const allowedOrigins = new Set(['http://localhost:4000']);
    const allowed = isAllowedMutationOrigin(
      'http://192.168.10.12:4000',
      allowedOrigins,
      {
        host: 'localhost:4000',
        'x-forwarded-host': '192.168.10.12:4000',
      },
      {
        trustForwardedHost: false,
      },
    );
    expect(allowed).toBe(false);
  });

  it('accepts forwarded-host same-origin checks only in trusted proxy mode', () => {
    const allowedOrigins = new Set(['http://localhost:4000']);
    const allowed = isAllowedMutationOrigin(
      'http://192.168.10.12:4000',
      allowedOrigins,
      {
        host: 'localhost:4000',
        'x-forwarded-host': '192.168.10.12:4000',
      },
      {
        trustForwardedHost: true,
      },
    );
    expect(allowed).toBe(true);
  });
});
