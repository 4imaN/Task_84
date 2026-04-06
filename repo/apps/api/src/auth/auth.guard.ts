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
import { parseCookieValue } from './auth-cookie.util';

const getRequest = (context: ExecutionContext) => {
  if (context.getType<'http' | 'graphql'>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext<{ req: RequestWithContext }>().req;
  }

  return context.switchToHttp().getRequest<RequestWithContext>();
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = getRequest(context);
    const token = parseCookieValue(request.headers.cookie, AUTH_COOKIE_NAME);

    if (!token) {
      throw new UnauthorizedException('Authentication is required.');
    }

    request.user = await this.authService.getSessionUser(token, request.traceId);
    request.token = token;
    return true;
  }
}
