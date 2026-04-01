import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response, NextFunction } from 'express';
import type { RequestWithContext } from './http';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: RequestWithContext, res: Response, next: NextFunction) {
    req.traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    res.setHeader('x-trace-id', req.traceId);
    next();
  }
}

