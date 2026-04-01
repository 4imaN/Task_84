import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

interface CipherEnvelope {
  iv: string;
  tag: string;
  content: string;
}

const deriveEncryptionKey = (secret: string) => createHash('sha256').update(secret).digest();

export const normalizeIdentifier = (value: string) => value.trim().toLowerCase();

export const createIdentifierLookupHash = (secret: string, value: string) =>
  createHmac('sha256', deriveEncryptionKey(secret)).update(normalizeIdentifier(value)).digest('hex');

export const encryptAtRestValue = (secret: string, value: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveEncryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

  const envelope: CipherEnvelope = {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    content: encrypted.toString('base64'),
  };

  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
};

export const decryptAtRestValue = (secret: string, value: string) => {
  const envelope = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as CipherEnvelope;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveEncryptionKey(secret),
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(envelope.content, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};
