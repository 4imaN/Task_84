const STORAGE_PREFIX = 'ledgerread';
const LEGACY_THEME_PREFIX = `${STORAGE_PREFIX}.theme.`;
const LEGACY_PROFILE_PREFIX = `${STORAGE_PREFIX}.profile.`;

const hashStorageLabel = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let hash = 0xcbf29ce484222325n;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }

  return hash.toString(16).padStart(16, '0');
};

export const getThemeStorageKey = (username: string) => `${LEGACY_THEME_PREFIX}${hashStorageLabel(username)}`;

export const getLegacyThemeStorageKey = (username: string) => `${LEGACY_THEME_PREFIX}${username}`;

export const getLegacyProfileKey = (username: string) => `${LEGACY_PROFILE_PREFIX}${username}`;

export const getProfileKeyId = (username: string) => `profile:${hashStorageLabel(username)}`;

export const getLegacyProfileKeyId = (username: string) => `profile:${username}`;

export const getProfileStorageKey = (username: string) => `profile-record:${hashStorageLabel(username)}`;

export const getLegacyProfileStorageKey = (username: string) => username;

export const getTitleStorageKey = (username: string, titleId: string) =>
  `title:${hashStorageLabel(`${username}:${titleId}`)}`;

export const getLegacyTitleStoragePrefix = (username: string) => `${username}:`;

export const migrateThemeStorageKey = (username: string) => {
  if (typeof window === 'undefined') {
    return getThemeStorageKey(username);
  }

  const nextKey = getThemeStorageKey(username);
  const legacyKey = getLegacyThemeStorageKey(username);
  const nextValue = window.localStorage.getItem(nextKey);
  const legacyValue = window.localStorage.getItem(legacyKey);

  if (nextValue === null && legacyValue !== null) {
    window.localStorage.setItem(nextKey, legacyValue);
  }

  if (legacyValue !== null) {
    window.localStorage.removeItem(legacyKey);
  }

  return nextKey;
};
