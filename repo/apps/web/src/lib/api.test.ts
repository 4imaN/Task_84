import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, graphQLRequest } from './api';
import type { AppSession } from './types';

describe('api transport and telemetry', () => {
  const originalFetch = global.fetch;
  const session: AppSession = {
    user: {
      id: 'user-1',
      username: 'reader.ada',
      role: 'CUSTOMER',
      workspace: 'app',
    },
    homePath: '/app/library',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    window.__ledgerreadTelemetry__ = [];
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete window.__ledgerreadTelemetry__;
  });

  it('uses cookie-only REST requests and records the server trace id in client telemetry', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-trace-id': 'trace-rest-1',
        },
      }),
    );

    await apiRequest('/auth/session', {}, session);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/session'),
      expect.objectContaining({
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );
    expect(window.__ledgerreadTelemetry__).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layer: 'rest',
          method: 'GET',
          target: '/auth/session',
          status: 200,
          ok: true,
          traceId: 'trace-rest-1',
          workspace: 'app',
          role: 'CUSTOMER',
        }),
      ]),
    );
  });

  it('uses cookie-only GraphQL requests and records error telemetry from the server trace id', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [
            {
              message: 'The session has expired.',
              extensions: {
                code: 'UNAUTHENTICATED',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-trace-id': 'trace-graphql-1',
          },
        },
      ),
    );

    await expect(graphQLRequest('query { catalog { featured { id } } }', undefined, session)).rejects.toThrow(
      'The session has expired.',
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/graphql'),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );
    expect(window.__ledgerreadTelemetry__).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layer: 'graphql',
          method: 'POST',
          target: '/graphql',
          status: 401,
          ok: false,
          traceId: 'trace-graphql-1',
        }),
      ]),
    );
  });
});
