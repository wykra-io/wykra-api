import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

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
}
