import type { AppSession } from './types';
import { recordClientTelemetry, sanitizeClientMessage } from './telemetry';

const DEFAULT_APP_ORIGIN =
  typeof window === 'undefined' ? 'http://localhost:4000' : window.location.origin;

type UnauthorizedHandler = (status: number) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? DEFAULT_APP_ORIGIN;
export const GRAPHQL_URL = import.meta.env.VITE_GRAPHQL_URL ?? `${API_BASE_URL}/graphql`;

export const setUnauthorizedHandler = (handler: UnauthorizedHandler | null) => {
  unauthorizedHandler = handler;
};

const extractTraceId = (response: Pick<Response, 'headers'> | { headers?: { get?: (name: string) => string | null } }, payload: any) =>
  response.headers?.get?.('x-trace-id') ?? (typeof payload?.traceId === 'string' ? payload.traceId : null);

const handleUnauthorized = (status: number, session?: AppSession | null) => {
  if (session && (status === 401 || status === 403)) {
    unauthorizedHandler?.(status);
  }
};

const getDetailedPayloadMessage = (payload: any, fallback: string) =>
  typeof payload?.message === 'string'
    ? payload.message
    : Array.isArray(payload?.message)
      ? payload.message.join(', ')
      : fallback;

export const apiRequest = async <T,>(
  path: string,
  options: RequestInit = {},
  session?: AppSession | null,
) => {
  const method = options.method ?? 'GET';
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers ?? {}),
      },
    });
  } catch (error) {
    const message = sanitizeClientMessage(
      null,
      false,
      error instanceof Error ? error.message : 'Network request failed.',
    ) ?? 'Network request failed.';
    recordClientTelemetry({
      layer: 'rest',
      method,
      target: path,
      status: null,
      ok: false,
      traceId: null,
      session,
      message,
    });
    throw new Error(message);
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  const traceId = extractTraceId(response, payload);
  const detailedMessage = response.ok ? undefined : getDetailedPayloadMessage(payload, response.statusText);
  const publicMessage = response.ok
    ? undefined
    : sanitizeClientMessage(response.status, false, detailedMessage) ?? 'The request could not be completed.';

  recordClientTelemetry({
    layer: 'rest',
    method,
    target: path,
    status: response.status,
    ok: response.ok,
    traceId,
    session,
    message: publicMessage,
  });

  if (!response.ok) {
    handleUnauthorized(response.status, session);
    const error = new Error(publicMessage ?? 'The request could not be completed.') as Error & {
      status?: number;
      payload?: unknown;
    };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload as T;
};

export const graphQLRequest = async <T,>(
  query: string,
  variables: Record<string, unknown> | undefined,
  session: AppSession,
) => {
  let response: Response;

  try {
    response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    recordClientTelemetry({
      layer: 'graphql',
      method: 'POST',
      target: '/graphql',
      status: null,
      ok: false,
      traceId: null,
      session,
      message: error instanceof Error ? error.message : 'GraphQL request failed.',
    });
    throw error;
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{
      message: string;
      extensions?: {
        code?: string;
        originalError?: {
          statusCode?: number;
        };
      };
    }>;
  };

  const graphQlStatus =
    payload.errors?.[0]?.extensions?.originalError?.statusCode ??
    (payload.errors?.[0]?.extensions?.code === 'UNAUTHENTICATED' ? 401 : undefined);
  const traceId =
    response.headers?.get?.('x-trace-id') ??
    (typeof (payload.data as { traceId?: unknown } | undefined)?.traceId === 'string'
      ? String((payload.data as { traceId?: unknown }).traceId)
      : null);
  const graphQlErrorMessage = payload.errors?.[0]?.message;
  const publicGraphQlMessage = sanitizeClientMessage(
    graphQlStatus ?? response.status,
    response.ok && !payload.errors?.length,
    graphQlErrorMessage,
  ) ?? 'GraphQL request failed.';

  recordClientTelemetry({
    layer: 'graphql',
    method: 'POST',
    target: '/graphql',
    status: graphQlStatus ?? response.status,
    ok: response.ok && !payload.errors?.length,
    traceId,
    session,
    message: publicGraphQlMessage,
  });

  if (!response.ok || payload.errors?.length) {
    handleUnauthorized(graphQlStatus ?? response.status, session);
    throw new Error(publicGraphQlMessage);
  }

  return payload.data as T;
};
