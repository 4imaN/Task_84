import type { IncomingHttpHeaders } from 'node:http';

const DEV_DEFAULT_ORIGINS = ['http://localhost:4173', 'http://127.0.0.1:4173'] as const;

const normalizeOrigin = (value: string, source: string) => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${source} contains an invalid origin: "${value}".`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${source} only supports http/https origins: "${value}".`);
  }

  return parsed.origin;
};

const splitAdditionalOrigins = (raw?: string) => {
  if (!raw?.trim()) {
    return [];
  }

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const firstHeaderValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) {
    return value[0]?.trim();
  }

  return value?.trim();
};

const resolveRequestHost = (
  headers: IncomingHttpHeaders,
  options: {
    trustForwardedHost: boolean;
  },
) => {
  const forwardedHost = options.trustForwardedHost
    ? firstHeaderValue(headers['x-forwarded-host'])?.split(',')[0]?.trim()
    : undefined;
  const fallbackHost = firstHeaderValue(headers.host)?.split(',')[0]?.trim();

  return forwardedHost || fallbackHost || null;
};

export const parseConfiguredOrigins = (raw?: string) =>
  splitAdditionalOrigins(raw).map((origin) => normalizeOrigin(origin, 'APP_ALLOWED_ORIGINS'));

export const buildAllowedOrigins = (appBaseUrl: string, configuredOrigins: string[] = []) =>
  Array.from(
    new Set(
      [normalizeOrigin(appBaseUrl, 'APP_BASE_URL'), ...DEV_DEFAULT_ORIGINS, ...configuredOrigins].map((origin) =>
        normalizeOrigin(origin, 'allowed origins'),
      ),
    ),
  );

export const isAllowedMutationOrigin = (
  candidateOrigin: string,
  allowedOrigins: Set<string>,
  headers: IncomingHttpHeaders,
  options: {
    trustForwardedHost?: boolean;
  } = {},
) => {
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(candidateOrigin);
  } catch {
    return false;
  }

  const normalizedCandidate = parsedOrigin.origin;
  if (allowedOrigins.has(normalizedCandidate)) {
    return true;
  }

  const requestHost = resolveRequestHost(headers, {
    trustForwardedHost: options.trustForwardedHost === true,
  });
  if (!requestHost) {
    return false;
  }

  try {
    const sameHostOrigin = new URL(`${parsedOrigin.protocol}//${requestHost}`).origin;
    return sameHostOrigin === normalizedCandidate;
  } catch {
    return false;
  }
};
