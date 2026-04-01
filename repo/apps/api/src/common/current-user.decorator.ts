import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { RequestWithContext } from './http';

const getRequest = (context: ExecutionContext): RequestWithContext => {
  if (context.getType<'http' | 'graphql'>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext<{ req: RequestWithContext }>().req;
  }

  return context.switchToHttp().getRequest<RequestWithContext>();
};

export const CurrentUser = createParamDecorator((_, context: ExecutionContext) => getRequest(context).user);
export const CurrentTraceId = createParamDecorator((_, context: ExecutionContext) => getRequest(context).traceId);

