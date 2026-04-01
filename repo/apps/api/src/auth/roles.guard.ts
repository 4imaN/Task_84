import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { RequestWithContext } from '../common/http';
import { ALLOWED_ROLES_KEY } from './roles.decorator';

const getRequest = (context: ExecutionContext) => {
  if (context.getType<'http' | 'graphql'>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext<{ req: RequestWithContext }>().req;
  }

  return context.switchToHttp().getRequest<RequestWithContext>();
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const allowedRoles = this.reflector.getAllAndOverride<string[]>(ALLOWED_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!allowedRoles?.length) {
      return true;
    }

    const request = getRequest(context);
    if (!request.user || !allowedRoles.includes(request.user.role)) {
      throw new ForbiddenException('This route is restricted to a different role.');
    }

    return true;
  }
}

