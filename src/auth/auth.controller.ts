import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { Public } from './decorators/public.decorator';
import { SkipThrottle } from './decorators/skip-throttle.decorator';
import { AuthService } from './auth.service';
import type { AuthTokenResponse } from './interfaces/auth-token-response.interface';
import { GITHUB_AUTH_CACHE_TTL_SECONDS } from './constants';
import { User } from '@libs/entities/user.entity';
import { EmailAuthDto, SocialAuthDto } from './dto';

const GITHUB_APP_STATE_COOKIE = 'wykra_gh_state';
const GITHUB_APP_RETURNTO_COOKIE = 'wykra_gh_returnTo';

function parseCookies(
  cookieHeader: string | undefined,
): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey?.trim();
    if (!key) continue;
    out[key] = rest.join('=').trim();
  }
  return out;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Validates a GitHub access token (Bearer token), upserts a user, and returns an API token.
   *
   * Header required:
   *   Authorization: Bearer <github_token>
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('githubAuth')
  public async githubAuth(@Req() req: Request): Promise<AuthTokenResponse> {
    return this.authService.githubAuthToApiToken(req);
  }

  /**
   * Social auth entrypoint (mirrors Tensai):
   * - provider=telegram expects Telegram WebApp initData string in `code`
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('social')
  public async socialAuth(
    @Body() dto: SocialAuthDto,
  ): Promise<AuthTokenResponse> {
    if (dto.provider === 'telegram') {
      return this.authService.telegramAuthToApiTokenFromTelegramCode(dto.code);
    }
    if (dto.provider === 'google') {
      return this.authService.googleAuthToApiToken(dto.code);
    }
    throw new UnauthorizedException('Unsupported provider');
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('register')
  public async register(@Body() dto: EmailAuthDto): Promise<AuthTokenResponse> {
    return this.authService.emailRegister(dto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  public async login(@Body() dto: EmailAuthDto): Promise<AuthTokenResponse> {
    return this.authService.emailLogin(dto);
  }

  @SkipThrottle()
  @Get('me')
  public me(@Req() req: Request & { user?: User }): {
    githubLogin: string;
    githubAvatarUrl: string | null;
    isAdmin: boolean;
  } {
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException('Missing user');
    }

    const login =
      user.githubLogin ||
      user.telegramUsername ||
      user.googleName ||
      user.email ||
      [user.telegramFirstName, user.telegramLastName]
        .filter(Boolean)
        .join(' ') ||
      'User';
    const avatar =
      user.githubAvatarUrl ?? user.telegramPhotoUrl ?? user.googlePicture ?? null;

    return {
      githubLogin: login,
      githubAvatarUrl: avatar,
      isAdmin: user.isAdmin ?? false,
    };
  }

  @Post('logout')
  public async logout(@Req() req: Request & { user?: User }): Promise<{
    ok: true;
  }> {
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException('Missing user');
    }
    await this.authService.logoutApiToken(req, user.id);
    return { ok: true };
  }

  /**
   * GitHub App OAuth (user-to-server) start: redirects to GitHub authorize URL.
   *
   * Optional:
   *  - returnTo: absolute URL to redirect to after callback (must match allowed origins)
   */
  @Public()
  @Get('github/app/start')
  public async githubAppStart(
    @Query('returnTo') returnTo: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { authorizeUrl, state } =
      await this.authService.githubAppBuildAuthorizeUrl({ returnTo });

    const isProd = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: GITHUB_AUTH_CACHE_TTL_SECONDS * 1000,
    };

    res.cookie(GITHUB_APP_STATE_COOKIE, state, cookieOptions);
    if (returnTo) {
      res.cookie(GITHUB_APP_RETURNTO_COOKIE, returnTo, cookieOptions);
    } else {
      res.clearCookie(GITHUB_APP_RETURNTO_COOKIE, { path: '/' });
    }

    res.redirect(302, authorizeUrl);
  }

  /**
   * GitHub App OAuth callback: exchanges code for GitHub access token,
   * then returns/redirects with an API token.
   */
  @Public()
  @Get('github/app/callback')
  public async githubAppCallback(
    @Req() req: Request,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    return this.handleGithubCallback(req, res, code, state);
  }

  /**
   * Alias callback for simpler redirect URIs (e.g. `/api/v1/auth/github`)
   */
  @Public()
  @Get('github')
  public async githubCallback(
    @Req() req: Request,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    return this.handleGithubCallback(req, res, code, state);
  }

  private async handleGithubCallback(
    req: Request,
    res: Response,
    code: string,
    state: string,
  ): Promise<void> {
    const cookies = parseCookies(req.headers.cookie);
    const cookieState = cookies[GITHUB_APP_STATE_COOKIE];
    if (!cookieState || cookieState !== state) {
      throw new UnauthorizedException('Invalid or expired state');
    }

    const returnToRaw = cookies[GITHUB_APP_RETURNTO_COOKIE];
    let returnTo: string | undefined;
    if (returnToRaw) {
      try {
        returnTo = decodeURIComponent(returnToRaw);
      } catch {
        returnTo = returnToRaw;
      }
    }

    // one-time-ish use; clear even if later steps fail
    res.clearCookie(GITHUB_APP_STATE_COOKIE, { path: '/' });
    res.clearCookie(GITHUB_APP_RETURNTO_COOKIE, { path: '/' });

    const { apiToken } = await this.authService.githubAppCallbackToApiToken({
      code,
      returnTo,
    });

    if (!returnTo) {
      res.status(200).json({ token: apiToken } satisfies AuthTokenResponse);
      return;
    }

    const url = new URL(returnTo);
    url.hash = `token=${encodeURIComponent(apiToken)}`;
    res.redirect(302, url.toString());
  }
}
