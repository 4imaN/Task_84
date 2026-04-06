import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { AppConfig } from '../config/app-config';
import {
  createIdentifierLookupHash,
  decryptAtRestValue,
  encryptAtRestValue,
} from './identifier';

const canonicalizeForHash = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeForHash(entry));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((accumulator, [key, entryValue]) => {
        accumulator[key] = canonicalizeForHash(entryValue);
        return accumulator;
      }, {});
  }

  return value;
};

@Injectable()
export class SecurityService {
  private readonly rawKey: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.rawKey = configService.get('encryptionKey', { infer: true });
  }

  encryptAtRest(value: string) {
    return encryptAtRestValue(this.rawKey, value);
  }

  decryptAtRest(value: string) {
    return decryptAtRestValue(this.rawKey, value);
  }

  hashLookup(value: string) {
    return createIdentifierLookupHash(this.rawKey, value);
  }

  hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  generateOpaqueToken() {
    return randomBytes(32).toString('hex');
  }

  checksum(buffer: Buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }

  hashChain(payload: unknown, previousHash: string | null) {
    return createHash('sha256')
      .update(
        JSON.stringify(
          canonicalizeForHash({
            previousHash,
            payload,
          }),
        ),
      )
      .digest('hex');
  }

  signChain(recordType: string, payload: unknown, previousHash: string | null, currentHash: string) {
    return createHmac('sha256', this.rawKey)
      .update(
        JSON.stringify(
          canonicalizeForHash({
            recordType,
            previousHash,
            currentHash,
            payload,
          }),
        ),
      )
      .digest('hex');
  }
}
