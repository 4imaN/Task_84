import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { isAllowedMutationOrigin } from './common/allowed-origins';
import { loadConfig, type AppConfig } from './config/app-config';
import { AppModule } from './app.module';

const CORS_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'];
const CORS_ALLOWED_HEADERS = ['Content-Type', 'X-Trace-Id', 'X-CSRF-Token'];
const CORS_EXPOSED_HEADERS = ['x-trace-id'];

export const createBootstrapApp = async (providedConfig?: AppConfig) => {
  const config = providedConfig ?? loadConfig();
  const allowedOrigins = new Set(config.allowedOrigins);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: false });
  app.set('trust proxy', config.trustedProxyHops);

  app.enableCors((request, callback) => {
    const originHeader = request.header('origin');
    const originAllowed =
      !originHeader ||
      isAllowedMutationOrigin(originHeader, allowedOrigins, request.headers, {
        trustForwardedHost: config.trustedProxyHops > 0,
      });

    callback(null, {
      origin: originAllowed,
      credentials: true,
      methods: CORS_METHODS,
      allowedHeaders: CORS_ALLOWED_HEADERS,
      exposedHeaders: CORS_EXPOSED_HEADERS,
    });
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const webDistPath = join(__dirname, '../../web/dist');
  if (existsSync(webDistPath)) {
    app.useStaticAssets(webDistPath);

    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use((request: Request, response: Response, next: () => void) => {
      if (request.method !== 'GET') {
        next();
        return;
      }

      const path = request.path;
      const isFrontendRoute =
        path === '/' ||
        path === '/login' ||
        path === '/app' ||
        path === '/app/library' ||
        path === '/app/community' ||
        path === '/app/profile' ||
        path.startsWith('/app/reader/') ||
        path === '/pos' ||
        path === '/pos/login' ||
        path === '/pos/checkout' ||
        path === '/pos/attendance' ||
        path === '/mod' ||
        path === '/mod/login' ||
        path === '/mod/queue' ||
        path === '/admin' ||
        path === '/admin/login' ||
        path === '/admin/overview' ||
        path === '/admin/finance' ||
        path === '/admin/inventory' ||
        path === '/admin/audits' ||
        path === '/finance' ||
        path === '/finance/login' ||
        path === '/finance/settlements' ||
        path === '/finance/audits';

      if (!isFrontendRoute) {
        next();
        return;
      }

      response.sendFile(join(webDistPath, 'index.html'));
    });
  }

  return { app, config };
};

export async function bootstrap() {
  const { app, config } = await createBootstrapApp();
  await app.listen(config.port);
}

if (require.main === module) {
  void bootstrap();
}
