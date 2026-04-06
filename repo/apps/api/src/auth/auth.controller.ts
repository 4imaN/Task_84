import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { CookieOptions } from 'express';
import type { RequestWithContext } from '../common/http';
import type { AppConfig } from '../config/app-config';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CsrfService } from './csrf.service';
import { AUTH_COOKIE_NAME } from './auth.constants';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly csrfService: CsrfService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  private getCookieOptions(): CookieOptions {
    const appBaseUrl = this.configService.get('appBaseUrl', { infer: true });

    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: appBaseUrl.startsWith('https://'),
      path: '/',
    };
  }

  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Req() req: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.login(body.username, body.password, body.workspace, req.traceId);
    response.cookie(AUTH_COOKIE_NAME, session.token, this.getCookieOptions());

    return {
      user: session.user,
      homePath: session.homePath,
      csrfToken: this.csrfService.issueToken(session.token),
    };
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(@Req() req: RequestWithContext, @Res({ passthrough: true }) response: Response) {
    if (req.token) {
      await this.authService.logout(req.token);
    }
    response.clearCookie(AUTH_COOKIE_NAME, this.getCookieOptions());

    return { ok: true };
  }

  @Get('session')
  @UseGuards(AuthGuard)
  session(@Req() req: RequestWithContext) {
    return {
      user: req.user,
      homePath:
        req.user?.workspace === 'app'
          ? '/app/library'
          : req.user?.workspace === 'pos'
            ? '/pos/checkout'
            : req.user?.workspace === 'mod'
              ? '/mod/queue'
              : req.user?.workspace === 'finance'
                ? '/finance/settlements'
                : '/admin/overview',
      traceId: req.traceId,
      csrfToken: this.csrfService.issueToken(req.token!),
    };
  }
}
