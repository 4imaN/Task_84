import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config/app-config';

@Injectable()
export class CsrfService {
  private readonly secret: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.secret = configService.get('encryptionKey', { infer: true });
  }

  issueToken(sessionToken: string) {
    const nonce = randomBytes(16).toString('hex');
    const signature = createHmac('sha256', this.secret)
      .update(`${sessionToken}.${nonce}`)
      .digest('hex');

    return `${nonce}.${signature}`;
  }

  validateToken(sessionToken: string, token: string) {
    const [nonce, signature, ...rest] = token.split('.');
    if (!nonce || !signature || rest.length > 0 || !/^[a-f0-9]+$/i.test(nonce) || !/^[a-f0-9]+$/i.test(signature)) {
      return false;
    }

    const expectedSignature = createHmac('sha256', this.secret)
      .update(`${sessionToken}.${nonce}`)
      .digest('hex');

    const providedBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(providedBuffer, expectedBuffer);
  }
}
