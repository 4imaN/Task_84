import { openDB } from 'idb';
import {
  decryptJsonWithKey,
  encryptJsonWithKey,
  generateDeviceEncryptionKey,
  type KeyCipherPayload,
} from '@ledgerread/crypto';
import type { ReadingProfileRecord } from '@ledgerread/contracts';
import type { TitleDetail } from './types';
import {
  getLegacyProfileKey,
  getLegacyProfileKeyId,
  getLegacyProfileStorageKey,
  getLegacyTitleStoragePrefix,
  getProfileKeyId,
  getProfileStorageKey,
  getTitleStorageKey,
} from './storageKeys';

const OFFLINE_DB_NAME = 'ledgerread-offline';
const PROFILE_STORE = 'profiles';
const TITLE_STORE = 'titles';
const KEY_STORE = 'keys';

type StoredProfileRecord = {
  updatedAt: string;
  payload: KeyCipherPayload;
};

type StoredTitleRecord = {
  cachedAt: string;
  payload: KeyCipherPayload;
};

const getOfflineDb = () =>
  openDB(OFFLINE_DB_NAME, 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(TITLE_STORE)) {
        db.createObjectStore(TITLE_STORE);
      }
      if (!db.objectStoreNames.contains(PROFILE_STORE)) {
        db.createObjectStore(PROFILE_STORE);
      }
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE);
      }
    },
  });

const isReadingProfileRecord = (value: unknown): value is ReadingProfileRecord => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ReadingProfileRecord>;
  return (
    typeof candidate.username === 'string' &&
    typeof candidate.deviceLabel === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    typeof candidate.preferences?.updatedAt === 'string'
  );
};

const loadLegacyLocalProfile = (username: string) => {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(getLegacyProfileKey(username));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return isReadingProfileRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const clearLegacyLocalProfile = (username: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(getLegacyProfileKey(username));
};

const migrationTasks = new Map<string, Promise<void>>();

const migrateLegacyUserStorage = async (username: string) => {
  const existingTask = migrationTasks.get(username);
  if (existingTask) {
    await existingTask;
    return;
  }

  const task = (async () => {
    const db = await getOfflineDb();
    const nextKeyId = getProfileKeyId(username);
    const legacyKeyId = getLegacyProfileKeyId(username);
    const legacyKey = (await db.get(KEY_STORE, legacyKeyId)) as CryptoKey | undefined;
    const nextKey = (await db.get(KEY_STORE, nextKeyId)) as CryptoKey | undefined;

    if (!nextKey && legacyKey) {
      await db.put(KEY_STORE, legacyKey, nextKeyId);
    }
    if (legacyKey) {
      await db.delete(KEY_STORE, legacyKeyId);
    }

    const nextProfileKey = getProfileStorageKey(username);
    const legacyProfileKey = getLegacyProfileStorageKey(username);
    const legacyProfile = (await db.get(PROFILE_STORE, legacyProfileKey)) as StoredProfileRecord | undefined;
    const encryptedProfile = (await db.get(PROFILE_STORE, nextProfileKey)) as StoredProfileRecord | undefined;
    if (!encryptedProfile && legacyProfile) {
      await db.put(PROFILE_STORE, legacyProfile, nextProfileKey);
    }
    if (legacyProfile) {
      await db.delete(PROFILE_STORE, legacyProfileKey);
    }

    const legacyTitlePrefix = getLegacyTitleStoragePrefix(username);
    const existingTitleKeys = await db.getAllKeys(TITLE_STORE);
    const legacyTitleKeys = existingTitleKeys
      .map((value) => String(value))
      .filter((key) => key.startsWith(legacyTitlePrefix));

    for (const legacyKeyValue of legacyTitleKeys) {
      const titleId = legacyKeyValue.slice(legacyTitlePrefix.length);
      const nextTitleKey = getTitleStorageKey(username, titleId);
      const alreadyMigrated = await db.get(TITLE_STORE, nextTitleKey);
      if (!alreadyMigrated) {
        const legacyRecord = (await db.get(TITLE_STORE, legacyKeyValue)) as StoredTitleRecord | undefined;
        if (legacyRecord) {
          await db.put(TITLE_STORE, legacyRecord, nextTitleKey);
        }
      }
      await db.delete(TITLE_STORE, legacyKeyValue);
    }
  })();

  migrationTasks.set(username, task);

  try {
    await task;
  } finally {
    migrationTasks.delete(username);
  }
};

const getOrCreateUserKey = async (username: string, createIfMissing: boolean) => {
  await migrateLegacyUserStorage(username);
  const db = await getOfflineDb();
  const storageKey = getProfileKeyId(username);
  const existing = (await db.get(KEY_STORE, storageKey)) as CryptoKey | undefined;
  if (existing || !createIfMissing) {
    return existing ?? null;
  }

  const nextKey = await generateDeviceEncryptionKey();
  await db.put(KEY_STORE, nextKey, storageKey);
  return nextKey;
};

export const saveLocalProfile = async (profile: ReadingProfileRecord) => {
  const db = await getOfflineDb();
  const key = await getOrCreateUserKey(profile.username, true);
  const encrypted = await encryptJsonWithKey(key!, profile);
  await db.put(
    PROFILE_STORE,
    {
      updatedAt: profile.updatedAt,
      payload: encrypted,
    } satisfies StoredProfileRecord,
    getProfileStorageKey(profile.username),
  );
  clearLegacyLocalProfile(profile.username);
};

export const loadLocalProfile = async (username: string) => {
  await migrateLegacyUserStorage(username);
  const db = await getOfflineDb();
  const stored = (await db.get(PROFILE_STORE, getProfileStorageKey(username))) as StoredProfileRecord | undefined;
  const key = await getOrCreateUserKey(username, false);

  if (stored && key) {
    try {
      return await decryptJsonWithKey<ReadingProfileRecord>(key, stored.payload);
    } catch {
      await db.delete(PROFILE_STORE, getProfileStorageKey(username));
    }
  }

  const legacy = loadLegacyLocalProfile(username);
  if (!legacy) {
    clearLegacyLocalProfile(username);
    return null;
  }

  await saveLocalProfile(legacy);
  return legacy;
};

export const cacheEncryptedTitle = async (username: string, title: TitleDetail) => {
  const db = await getOfflineDb();
  const key = await getOrCreateUserKey(username, true);
  const encrypted = await encryptJsonWithKey(key!, title);
  await db.put(
    TITLE_STORE,
    {
      cachedAt: new Date().toISOString(),
      payload: encrypted,
    } satisfies StoredTitleRecord,
    getTitleStorageKey(username, title.id),
  );
};

export const loadCachedTitle = async (username: string, titleId: string) => {
  await migrateLegacyUserStorage(username);
  const db = await getOfflineDb();
  const key = await getOrCreateUserKey(username, false);
  const encrypted = (await db.get(TITLE_STORE, getTitleStorageKey(username, titleId))) as
    | StoredTitleRecord
    | undefined;

  if (!encrypted || !key) {
    return null;
  }

  try {
    return await decryptJsonWithKey<TitleDetail>(key, encrypted.payload);
  } catch {
    await db.delete(TITLE_STORE, getTitleStorageKey(username, titleId));
    return null;
  }
};
