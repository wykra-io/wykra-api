import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { Public } from './decorators/public.decorator';
import { AuthService } from './auth.service';
import type { AuthTokenResponse } from './interfaces/auth-token-response.interface';

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
    const url = await this.authService.githubAppBuildAuthorizeUrl({ returnTo });
    res.redirect(302, url);
  }

  /**
   * GitHub App OAuth callback: exchanges code for GitHub access token,
   * then returns/redirects with an API token.
   */
  @Public()
  @Get('github/app/callback')
  public async githubAppCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    const { apiToken, returnTo } =
      await this.authService.githubAppCallbackToApiToken({ code, state });

    if (!returnTo) {
      res.status(200).json({ token: apiToken } satisfies AuthTokenResponse);
      return;
    }

    const url = new URL(returnTo);
    url.hash = `token=${encodeURIComponent(apiToken)}`;
    res.redirect(302, url.toString());
  }
}
