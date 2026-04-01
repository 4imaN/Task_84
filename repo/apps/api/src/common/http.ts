import type { Request } from 'express';
import type { SessionUser } from '@ledgerread/contracts';

export interface RequestContext {
  traceId: string;
  user?: SessionUser;
  token?: string;
}

export type RequestWithContext = Request & RequestContext;

