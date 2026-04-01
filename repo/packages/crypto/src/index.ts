const encoder = new TextEncoder();
const decoder = new TextDecoder();

const assertCrypto = () => {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API is unavailable in this runtime.');
  }

  return globalThis.crypto;
};

const toBase64 = (bytes: Uint8Array) => {
  const binary = Array.from(bytes, (value) => String.fromCharCode(value)).join('');
  return globalThis.btoa(binary);
};

const fromBase64 = (value: string) =>
  Uint8Array.from(globalThis.atob(value), (character) => character.charCodeAt(0));

export interface CipherPayload {
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface KeyCipherPayload {
  iv: string;
  ciphertext: string;
}

export const sha256Hex = async (input: string) => {
  const digest = await assertCrypto().subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
};

const deriveAesKey = async (password: string, salt: Uint8Array) => {
  const keyMaterial = await assertCrypto().subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return assertCrypto().subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 150_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  );
};

export const generateDeviceEncryptionKey = () =>
  assertCrypto().subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  );

export const encryptJson = async (password: string, payload: unknown): Promise<CipherPayload> => {
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  assertCrypto().getRandomValues(salt);
  assertCrypto().getRandomValues(iv);
  const key = await deriveAesKey(password, salt);
  const ciphertext = await assertCrypto().subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
    },
    key,
    encoder.encode(JSON.stringify(payload)) as BufferSource,
  );

  return {
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
};

export const decryptJson = async <T>(password: string, payload: CipherPayload): Promise<T> => {
  const key = await deriveAesKey(password, fromBase64(payload.salt));
  const plaintext = await assertCrypto().subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(payload.iv) as BufferSource,
    },
    key,
    fromBase64(payload.ciphertext) as BufferSource,
  );

  return JSON.parse(decoder.decode(plaintext)) as T;
};

export const encryptJsonWithKey = async (
  key: CryptoKey,
  payload: unknown,
): Promise<KeyCipherPayload> => {
  const iv = new Uint8Array(12);
  assertCrypto().getRandomValues(iv);
  const ciphertext = await assertCrypto().subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
    },
    key,
    encoder.encode(JSON.stringify(payload)) as BufferSource,
  );

  return {
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
};

export const decryptJsonWithKey = async <T>(
  key: CryptoKey,
  payload: KeyCipherPayload,
): Promise<T> => {
  const plaintext = await assertCrypto().subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(payload.iv) as BufferSource,
    },
    key,
    fromBase64(payload.ciphertext) as BufferSource,
  );

  return JSON.parse(decoder.decode(plaintext)) as T;
};
