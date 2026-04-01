import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from '../config/app-config';
import {
  createIdentifierLookupHash,
  decryptAtRestValue,
  encryptAtRestValue,
} from './identifier';

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
      .update(JSON.stringify({ previousHash, payload }))
      .digest('hex');
  }
}
