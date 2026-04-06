import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { AppConfig } from '../config/app-config';
import { isAllowedMutationOrigin } from '../common/allowed-origins';
import type { RequestWithContext } from '../common/http';
import { AUTH_COOKIE_NAME, CSRF_HEADER_NAME } from './auth.constants';
import { parseCookieValue } from './auth-cookie.util';
import { CsrfService } from './csrf.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const getRequest = (context: ExecutionContext) => {
  if (context.getType<'http' | 'graphql'>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext<{ req: RequestWithContext }>().req;
  }

  return context.switchToHttp().getRequest<RequestWithContext>();
};

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;
  private readonly trustForwardedHost: boolean;

  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly csrfService: CsrfService,
  ) {
    this.allowedOrigins = new Set(configService.get('allowedOrigins', { infer: true }));
    this.trustForwardedHost = configService.get('trustedProxyHops', { infer: true }) > 0;
  }

  private readHeaderValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
  }

  private assertAllowedOrigin(
    request: RequestWithContext,
    options: {
      requireOriginHeader: boolean;
      disallowedMessage: string;
      malformedRefererMessage: string;
      missingOriginMessage: string;
    },
  ) {
    const originHeader = this.readHeaderValue(request.headers.origin);
    if (typeof originHeader === 'string') {
      if (
        !isAllowedMutationOrigin(originHeader, this.allowedOrigins, request.headers, {
          trustForwardedHost: this.trustForwardedHost,
        })
      ) {
        throw new ForbiddenException(options.disallowedMessage);
      }

      return;
    }

    const refererHeader = this.readHeaderValue(request.headers.referer);
    if (typeof refererHeader === 'string') {
      let refererOrigin: string;
      try {
        refererOrigin = new URL(refererHeader).origin;
      } catch {
        throw new ForbiddenException(options.malformedRefererMessage);
      }

      if (
        !isAllowedMutationOrigin(refererOrigin, this.allowedOrigins, request.headers, {
          trustForwardedHost: this.trustForwardedHost,
        })
      ) {
        throw new ForbiddenException(options.disallowedMessage);
      }

      return;
    }

    if (options.requireOriginHeader) {
      throw new ForbiddenException(options.missingOriginMessage);
    }
  }

  canActivate(context: ExecutionContext) {
    const request = getRequest(context);
    const method = request.method.toUpperCase();
    if (SAFE_METHODS.has(method)) {
      return true;
    }

    if (request.path === '/auth/login') {
      this.assertAllowedOrigin(request, {
        requireOriginHeader: true,
        disallowedMessage: 'Request origin is not allowed for login.',
        malformedRefererMessage: 'Request referer is malformed for login.',
        missingOriginMessage: 'Request origin is required for login.',
      });

      return true;
    }

    const sessionToken = parseCookieValue(request.headers.cookie, AUTH_COOKIE_NAME);
    if (!sessionToken) {
      return true;
    }

    const csrfHeader = request.headers[CSRF_HEADER_NAME];
    const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
    if (typeof csrfToken !== 'string' || !this.csrfService.validateToken(sessionToken, csrfToken)) {
      throw new ForbiddenException('CSRF protection token is missing or invalid.');
    }

    this.assertAllowedOrigin(request, {
      requireOriginHeader: false,
      disallowedMessage: 'Request origin is not allowed for authenticated mutations.',
      malformedRefererMessage: 'Request referer is malformed for authenticated mutations.',
      missingOriginMessage: 'Request origin is required for authenticated mutations.',
    });

    return true;
  }
}
