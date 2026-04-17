import { RequestContextMiddleware } from './request-context.middleware';
import type { Response, NextFunction } from 'express';
import type { RequestWithContext } from './http';

describe('RequestContextMiddleware', () => {
  let middleware: RequestContextMiddleware;
  let res: Partial<Response>;
  let next: jest.Mock<NextFunction>;

  beforeEach(() => {
    middleware = new RequestContextMiddleware();
    res = {
      setHeader: jest.fn(),
    };
    next = jest.fn();
  });

  it('generates a UUID traceId when x-trace-id header is absent', () => {
    const req = { headers: {} } as RequestWithContext;

    middleware.use(req, res as Response, next);

    expect(req.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(res.setHeader).toHaveBeenCalledWith('x-trace-id', req.traceId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('uses the incoming x-trace-id header when present', () => {
    const req = { headers: { 'x-trace-id': 'external-trace-42' } } as unknown as RequestWithContext;

    middleware.use(req, res as Response, next);

    expect(req.traceId).toBe('external-trace-42');
    expect(res.setHeader).toHaveBeenCalledWith('x-trace-id', 'external-trace-42');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('echoes the traceId back in the response header', () => {
    const req = { headers: {} } as RequestWithContext;
    middleware.use(req, res as Response, next);

    expect(res.setHeader).toHaveBeenCalledWith('x-trace-id', req.traceId);
  });

  it('always calls next() to continue the middleware chain', () => {
    const req = { headers: {} } as RequestWithContext;
    middleware.use(req, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
