import type { AppSession } from './types';

const MAX_CLIENT_TELEMETRY_EVENTS = 40;
const PRODUCTION_CLIENT = import.meta.env.PROD && !import.meta.env.VITEST;
const DEBUG_TELEMETRY_ENABLED = import.meta.env.DEV && !import.meta.env.VITEST;
const BUFFERED_TELEMETRY_ENABLED = !PRODUCTION_CLIENT || import.meta.env.VITE_ENABLE_CLIENT_TELEMETRY === 'true';

export type ClientTelemetryEvent = {
  timestamp: string;
  layer: 'rest' | 'graphql';
  method: string;
  target: string;
  status: number | null;
  ok: boolean;
  traceId: string | null;
  workspace?: AppSession['user']['workspace'] | undefined;
  role?: AppSession['user']['role'] | undefined;
  message?: string | undefined;
};

declare global {
  interface Window {
    __ledgerreadTelemetry__?: ClientTelemetryEvent[];
  }
}

export const sanitizeClientMessage = (
  status: number | null,
  ok: boolean,
  message?: string,
) => {
  if (!message) {
    return undefined;
  }

  if (!PRODUCTION_CLIENT) {
    return message;
  }

  if (ok) {
    return undefined;
  }

  if (status === null) {
    return 'Network request failed.';
  }

  if (status === 400) {
    return 'Request validation failed.';
  }

  if (status === 401) {
    return 'Authentication is required.';
  }

  if (status === 403) {
    return 'You are not allowed to perform this action.';
  }

  if (status === 404) {
    return 'The requested resource could not be found.';
  }

  if (status === 409) {
    return 'The request conflicted with the current server state.';
  }

  if (status >= 500) {
    return 'The local server could not complete the request.';
  }

  return 'The request could not be completed.';
};

const trimTelemetryBuffer = (events: ClientTelemetryEvent[]) =>
  events.slice(Math.max(events.length - MAX_CLIENT_TELEMETRY_EVENTS, 0));

export const recordClientTelemetry = (
  event: Omit<ClientTelemetryEvent, 'timestamp' | 'workspace' | 'role'> & {
    session?: AppSession | null | undefined;
  },
) => {
  const payload: ClientTelemetryEvent = {
    timestamp: new Date().toISOString(),
    layer: event.layer,
    method: event.method,
    target: event.target,
    status: event.status,
    ok: event.ok,
    traceId: event.traceId,
    message: sanitizeClientMessage(event.status, event.ok, event.message),
    workspace: event.session?.user.workspace,
    role: event.session?.user.role,
  };

  if (typeof window !== 'undefined' && BUFFERED_TELEMETRY_ENABLED) {
    const buffer = Array.isArray(window.__ledgerreadTelemetry__) ? window.__ledgerreadTelemetry__ : [];
    window.__ledgerreadTelemetry__ = trimTelemetryBuffer([...buffer, payload]);
    window.dispatchEvent(new CustomEvent('ledgerread:telemetry', { detail: payload }));
  }

  if (DEBUG_TELEMETRY_ENABLED) {
    const logger = payload.ok ? console.info : console.warn;
    logger('[LedgerReadClient]', payload);
  }

  return payload;
};
