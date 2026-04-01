import { describe, expect, it } from 'vitest';
import {
  getProfileKeyId,
  getProfileStorageKey,
  getThemeStorageKey,
  getTitleStorageKey,
} from './storageKeys';

describe('storage key obfuscation', () => {
  it('does not expose usernames or title ids in browser storage keys', () => {
    const username = 'reader.ada';
    const titleId = 'title-quiet-harbor';

    const keys = [
      getThemeStorageKey(username),
      getProfileKeyId(username),
      getProfileStorageKey(username),
      getTitleStorageKey(username, titleId),
    ];

    for (const key of keys) {
      expect(key).not.toContain(username);
      expect(key).not.toContain(titleId);
    }
  });
});
