import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { loadConfig } from './config/app-config';
import { AppModule } from './app.module';

async function bootstrap() {
  const config = loadConfig();
  const allowedOrigins = Array.from(
    new Set([config.appBaseUrl, 'http://localhost:4173', 'http://127.0.0.1:4173']),
  );
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
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

  await app.listen(config.port);
}

void bootstrap();
