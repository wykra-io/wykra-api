import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash, randomBytes } from 'crypto';
import type { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  API_AUTH_CACHE_TTL_SECONDS,
  GITHUB_AUTH_CACHE_TTL_SECONDS,
} from './constants';
import type { GithubAuthData } from './interfaces/github-auth-data.interface';
import type { AuthTokenResponse } from './interfaces/auth-token-response.interface';
import { User } from '@libs/entities/user.entity';
import { GithubConfigService } from '@libs/config';

@Injectable()
export class AuthService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly githubConfig: GithubConfigService,
  ) {}

  public async githubAuthFromRequest(req: Request): Promise<GithubAuthData> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }

    const token = auth.slice(7);
    return this.githubAuthFromToken(token);
  }

  public async githubAuthFromToken(token: string): Promise<GithubAuthData> {
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');

    const cached = await this.cache.get<GithubAuthData>(tokenHash);
    if (cached) return cached;

    const ghRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'wykra-api',
        Accept: 'application/vnd.github+json',
      },
    });

    if (!ghRes.ok) {
      throw new UnauthorizedException('Invalid GitHub token');
    }

    const user = (await ghRes.json()) as { id: number; login: string };
    const scopes =
      ghRes.headers
        .get('x-oauth-scopes')
        ?.split(',')
        .map((s) => s.trim()) ?? [];

    const authData: GithubAuthData = {
      githubId: user.id,
      login: user.login,
      scopes: scopes.filter(Boolean),
    };

    // cache-manager TTL is in seconds
    await this.cache.set(tokenHash, authData, GITHUB_AUTH_CACHE_TTL_SECONDS);

    return authData;
  }

  public async githubAuthToApiTokenFromGithubToken(
    githubToken: string,
  ): Promise<AuthTokenResponse> {
    const gh = await this.githubAuthFromToken(githubToken);
    const user = await this.upsertGithubUser(gh);
    const token = await this.rotateApiToken(user);
    return { token };
  }

  public async githubAuthToApiToken(req: Request): Promise<AuthTokenResponse> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = auth.slice(7);
    return this.githubAuthToApiTokenFromGithubToken(token);
  }

  public async apiAuthFromRequest(req: Request): Promise<User> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }

    const token = auth.slice(7);
    if (!token) throw new UnauthorizedException('Missing token');

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const cacheKey = `api:${tokenHash}`;

    const cached = await this.cache.get<User>(cacheKey);
    if (cached) return cached;

    const user = await this.usersRepo.findOne({
      where: { apiTokenHash: tokenHash },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid API token');
    }

    await this.cache.set(cacheKey, user, API_AUTH_CACHE_TTL_SECONDS);
    return user;
  }

  private async upsertGithubUser(gh: GithubAuthData): Promise<User> {
    const githubId = `${gh.githubId}`;
    let user = await this.usersRepo.findOne({ where: { githubId } });

    if (!user) {
      user = this.usersRepo.create({
        githubId,
        githubLogin: gh.login,
        githubScopes: gh.scopes,
        apiTokenHash: null,
        apiTokenCreatedAt: null,
      });
    } else {
      user.githubLogin = gh.login;
      user.githubScopes = gh.scopes;
    }

    return await this.usersRepo.save(user);
  }

  private async rotateApiToken(user: User): Promise<string> {
    const apiToken = randomBytes(32).toString('base64url');
    const apiTokenHash = createHash('sha256').update(apiToken).digest('hex');

    user.apiTokenHash = apiTokenHash;
    user.apiTokenCreatedAt = new Date();
    await this.usersRepo.save(user);

    return apiToken;
  }

  public githubAppBuildAuthorizeUrl(input?: {
    returnTo?: string;
  }): Promise<{ authorizeUrl: string; state: string; returnTo?: string }> {
    if (!this.githubConfig.isAppOauthConfigured) {
      throw new BadRequestException(
        'GitHub App OAuth is not configured on the server',
      );
    }

    const returnTo = input?.returnTo?.trim();
    if (returnTo) this.assertAllowedReturnTo(returnTo);

    const state = randomBytes(32).toString('base64url');

    const params = new URLSearchParams({
      client_id: this.githubConfig.appClientId!,
      redirect_uri: this.githubConfig.appRedirectUri!,
      state,
    });
    const scopes = this.githubConfig.appOauthScopes;
    if (typeof scopes === 'string' && scopes.length) {
      params.set('scope', scopes);
    }

    return Promise.resolve({
      authorizeUrl: `https://github.com/login/oauth/authorize?${params.toString()}`,
      state,
      returnTo: returnTo || undefined,
    });
  }

  public async githubAppCallbackToApiToken(input: {
    code: string;
    returnTo?: string;
  }): Promise<{ apiToken: string; returnTo?: string }> {
    if (!this.githubConfig.isAppOauthConfigured) {
      throw new BadRequestException(
        'GitHub App OAuth is not configured on the server',
      );
    }

    const code = input.code?.trim();
    if (!code) {
      throw new BadRequestException('Missing code');
    }

    const ghToken = await this.exchangeGithubAppCodeForToken(code);
    const { token } = await this.githubAuthToApiTokenFromGithubToken(ghToken);

    const returnTo = input.returnTo?.trim() || undefined;
    if (returnTo) this.assertAllowedReturnTo(returnTo);

    return { apiToken: token, returnTo };
  }

  private async exchangeGithubAppCodeForToken(code: string): Promise<string> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'wykra-api',
      },
      body: JSON.stringify({
        client_id: this.githubConfig.appClientId!,
        client_secret: this.githubConfig.appClientSecret!,
        code,
        redirect_uri: this.githubConfig.appRedirectUri!,
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!res.ok || !json.access_token) {
      const msg =
        json.error_description || json.error || 'OAuth exchange failed';
      throw new UnauthorizedException(msg);
    }

    return json.access_token;
  }

  private assertAllowedReturnTo(returnTo: string): void {
    let url: URL;
    try {
      url = new URL(returnTo);
    } catch {
      throw new BadRequestException('returnTo must be a valid absolute URL');
    }

    const allowed = this.githubConfig.appAllowedRedirectOrigins;
    if (!allowed.length) {
      throw new BadRequestException(
        'Redirects are disabled: GITHUB_APP_ALLOWED_REDIRECT_ORIGINS is not set',
      );
    }

    if (!allowed.includes(url.origin)) {
      throw new BadRequestException('returnTo origin is not allowed');
    }
  }
}
