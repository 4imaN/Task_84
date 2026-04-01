import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { RequestWithContext } from '../common/http';
import { AuthService } from './auth.service';
import { AUTH_COOKIE_NAME } from './auth.constants';

const getRequest = (context: ExecutionContext) => {
  if (context.getType<'http' | 'graphql'>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext<{ req: RequestWithContext }>().req;
  }

  return context.switchToHttp().getRequest<RequestWithContext>();
};

const parseCookieToken = (cookieHeader?: string) => {
  if (!cookieHeader) {
    return undefined;
  }

  const match = cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${AUTH_COOKIE_NAME}=`));

  return match ? decodeURIComponent(match.slice(AUTH_COOKIE_NAME.length + 1)) : undefined;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = getRequest(context);
    const header = request.headers.authorization;
    const token =
      (header?.startsWith('Bearer ') ? header.slice(7) : undefined) ??
      parseCookieToken(request.headers.cookie);

    if (!token) {
      throw new UnauthorizedException('Authentication is required.');
    }

    request.user = await this.authService.getSessionUser(token, request.traceId);
    request.token = token;
    return true;
  }
}
