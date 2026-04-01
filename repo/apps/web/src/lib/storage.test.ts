import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import { decryptJsonWithKey } from '@ledgerread/crypto';
import { getProfileKeyId, getProfileStorageKey } from './storageKeys';

vi.mock('idb', () => ({
  openDB: vi.fn(),
}));

vi.mock('@ledgerread/crypto', () => ({
  decryptJsonWithKey: vi.fn(),
  encryptJsonWithKey: vi.fn(),
  generateDeviceEncryptionKey: vi.fn(),
}));

describe('encrypted storage cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('cleans up a corrupted encrypted profile using the obfuscated storage key', async () => {
    const username = 'reader.ada';
    const profileKey = getProfileStorageKey(username);
    const keyId = getProfileKeyId(username);
    const db = {
      get: vi.fn(async (store: string, key: string) => {
        if (store === 'profiles' && key === profileKey) {
          return {
            updatedAt: '2026-03-29T00:00:00.000Z',
            payload: { iv: 'iv', salt: 'salt', ciphertext: 'ciphertext' },
          };
        }

        if (store === 'keys' && key === keyId) {
          return {} as CryptoKey;
        }

        return undefined;
      }),
      put: vi.fn(),
      delete: vi.fn(),
      getAllKeys: vi.fn(async () => []),
    };

    vi.mocked(openDB).mockResolvedValue(db as never);
    vi.mocked(decryptJsonWithKey).mockRejectedValue(new Error('corrupted payload'));

    const { loadLocalProfile } = await import('./storage');

    await expect(loadLocalProfile(username)).resolves.toBeNull();
    expect(db.delete).toHaveBeenCalledWith('profiles', profileKey);
    expect(db.delete).not.toHaveBeenCalledWith('profiles', username);
  });
});
