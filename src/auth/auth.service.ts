import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
} from 'crypto';
import { promisify } from 'util';
import { ServerClient } from 'postmark';

const scrypt = promisify(scryptCallback);
import type { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { parse } from 'node:querystring';
import {
  API_AUTH_CACHE_TTL_SECONDS,
  EMAIL_CONFIRMATION_TTL_HOURS,
  GITHUB_AUTH_CACHE_TTL_SECONDS,
} from './constants';
import type { GithubAuthData } from './interfaces/github-auth-data.interface';
import type {
  AuthTokenResponse,
  EmailConfirmResponse,
  EmailRegisterResponse,
} from './interfaces/auth-token-response.interface';
import { User } from '@libs/entities/user.entity';
import {
  GithubConfigService,
  PostmarkConfigService,
  TelegramConfigService,
} from '@libs/config';
import { EmailAuthDto } from './dto';

@Injectable()
export class AuthService {
  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  private async verifyPassword(
    password: string,
    hash: string,
  ): Promise<boolean> {
    const [salt, key] = hash.split(':');
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
    return derivedKey.toString('hex') === key;
  }
  private readonly logger = new Logger(AuthService.name);
  private postmarkClient: ServerClient;
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly githubConfig: GithubConfigService,
    private readonly postmarkConfig: PostmarkConfigService,
    private readonly telegramConfig: TelegramConfigService,
  ) {
    if (this.postmarkConfig.isConfigured) {
      this.postmarkClient = new ServerClient(this.postmarkConfig.serverToken!);
    }
  }

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

    const user = (await ghRes.json()) as {
      id: number;
      login: string;
      avatar_url?: string;
    };
    const scopes =
      ghRes.headers
        .get('x-oauth-scopes')
        ?.split(',')
        .map((s) => s.trim()) ?? [];

    const authData: GithubAuthData = {
      githubId: user.id,
      login: user.login,
      avatarUrl: user.avatar_url,
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

  public async telegramAuthToApiTokenFromTelegramCode(
    initData: string,
  ): Promise<AuthTokenResponse> {
    const tg = this.telegramAuthFromInitData(initData);
    const user = await this.upsertTelegramUser(tg);
    const token = await this.rotateApiToken(user);
    return { token };
  }

  public async googleAuthToApiToken(token: string): Promise<AuthTokenResponse> {
    const googleRes = await fetch(
      `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${token}`,
    );
    if (!googleRes.ok) {
      throw new UnauthorizedException('Invalid Google token');
    }
    const googleData = (await googleRes.json()) as {
      sub: string;
      email: string;
      name: string;
      picture: string;
    };

    let user = await this.usersRepo.findOne({
      where: { googleId: googleData.sub },
    });

    if (!user) {
      user = this.usersRepo.create({
        googleId: googleData.sub,
        googleEmail: googleData.email,
        googleName: googleData.name,
        googlePicture: googleData.picture,
      });
    } else {
      user.googleEmail = googleData.email;
      user.googleName = googleData.name;
      user.googlePicture = googleData.picture;
    }

    await this.usersRepo.save(user);
    const apiToken = await this.rotateApiToken(user);
    return { token: apiToken };
  }

  private ensurePostmarkClient(): ServerClient {
    if (this.postmarkClient) return this.postmarkClient;

    if (!this.postmarkConfig.isConfigured) {
      this.logger.error('Postmark is not configured for email confirmation');
      throw new ServiceUnavailableException(
        'Email confirmation is not configured',
      );
    }

    this.postmarkClient = new ServerClient(this.postmarkConfig.serverToken!);
    return this.postmarkClient;
  }

  private buildEmailConfirmationUrl(token: string): string {
    const confirmUrl = this.postmarkConfig.confirmUrl;
    if (!confirmUrl) {
      throw new ServiceUnavailableException(
        'Email confirmation URL is not configured',
      );
    }

    let url: URL;
    try {
      url = new URL(confirmUrl);
    } catch {
      throw new ServiceUnavailableException(
        'Email confirmation URL is invalid',
      );
    }
    url.searchParams.set('token', token);
    return url.toString();
  }

  private buildEmailVerification(): {
    token: string;
    tokenHash: string;
    expiresAt: Date;
  } {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(
      Date.now() + EMAIL_CONFIRMATION_TTL_HOURS * 60 * 60 * 1000,
    );
    return { token, tokenHash, expiresAt };
  }

  private async sendEmailConfirmation(
    email: string,
    token: string,
  ): Promise<void> {
    const client = this.ensurePostmarkClient();
    const confirmUrl = this.buildEmailConfirmationUrl(token);
    const ttlHours = EMAIL_CONFIRMATION_TTL_HOURS;
    const htmlBody = [
      '<p>Welcome to Wykra!</p>',
      '<p>Please confirm your email address by clicking the link below:</p>',
      `<p><a href="${confirmUrl}" target="_blank" rel="noopener noreferrer">Confirm email</a></p>`,
      `<p>This link expires in ${ttlHours} hours.</p>`,
    ].join('\n');
    const textBody = `Welcome to Wykra!\n\nConfirm your email address: ${confirmUrl}\n\nThis link expires in ${ttlHours} hours.`;

    try {
      await client.sendEmail({
        From: this.postmarkConfig.fromEmail!,
        To: email,
        Subject: 'Confirm your Wykra account',
        HtmlBody: htmlBody,
        TextBody: textBody,
        MessageStream: this.postmarkConfig.messageStream,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error('Postmark sendEmail failed', errorMessage);
      throw new ServiceUnavailableException(
        'Failed to send confirmation email',
      );
    }
  }

  public async emailRegister(
    dto: EmailAuthDto,
  ): Promise<EmailRegisterResponse> {
    const email = String(dto.email).toLowerCase().trim();
    const existing = await this.usersRepo.findOne({
      where: { email },
      select: ['id', 'email', 'emailVerifiedAt'],
    });

    if (existing?.emailVerifiedAt) {
      throw new ConflictException('User with this email already exists');
    }

    const password = String(dto.password);
    const passwordHash = await this.hashPassword(password);
    const verification = this.buildEmailVerification();
    const sentAt = new Date();

    if (existing) {
      await this.usersRepo.update(
        { id: existing.id },
        {
          passwordHash,
          emailVerificationTokenHash: verification.tokenHash,
          emailVerificationSentAt: sentAt,
          emailVerificationExpiresAt: verification.expiresAt,
        },
      );

      await this.sendEmailConfirmation(email, String(verification.token));
      return {
        confirmationRequired: true,
        message: 'Check your email to confirm your account.',
      };
    }

    const user = this.usersRepo.create({
      email,
      passwordHash,
      emailVerifiedAt: null,
      emailVerificationTokenHash: verification.tokenHash,
      emailVerificationSentAt: sentAt,
      emailVerificationExpiresAt: verification.expiresAt,
      githubId: null,
      githubLogin: null,
      githubAvatarUrl: null,
      githubScopes: null,
      telegramId: null,
      telegramUsername: null,
      telegramFirstName: null,
      telegramLastName: null,
      telegramPhotoUrl: null,
      apiTokenHash: null,
      apiTokenCreatedAt: null,
    });

    await this.usersRepo.save(user);
    await this.sendEmailConfirmation(email, String(verification.token));

    return {
      confirmationRequired: true,
      message: 'Check your email to confirm your account.',
    };
  }

  public async emailLogin(dto: EmailAuthDto): Promise<AuthTokenResponse> {
    const email = String(dto.email).toLowerCase().trim();
    const user = await this.usersRepo.findOne({
      where: { email },
      select: [
        'id',
        'email',
        'passwordHash',
        'apiTokenHash',
        'apiTokenCreatedAt',
        'emailVerifiedAt',
      ],
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const password = String(dto.password);
    const passwordHash = String(user.passwordHash);
    const isPasswordValid = await this.verifyPassword(password, passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Please confirm your email');
    }

    const token = await this.rotateApiToken(user);
    return { token };
  }

  public async confirmEmail(token: string): Promise<EmailConfirmResponse> {
    const rawToken = token?.trim();
    if (!rawToken) {
      throw new BadRequestException('Missing token');
    }

    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const user = await this.usersRepo.findOne({
      where: { emailVerificationTokenHash: tokenHash },
      select: ['id', 'emailVerifiedAt', 'emailVerificationExpiresAt'],
    });

    if (!user) {
      throw new BadRequestException('Invalid confirmation token');
    }

    if (user.emailVerifiedAt) {
      return { confirmed: true };
    }

    if (
      user.emailVerificationExpiresAt &&
      user.emailVerificationExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('Confirmation token expired');
    }

    await this.usersRepo.update(
      { id: user.id },
      {
        emailVerifiedAt: new Date(),
        emailVerificationTokenHash: null,
        emailVerificationSentAt: null,
        emailVerificationExpiresAt: null,
      },
    );

    return { confirmed: true };
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
        githubAvatarUrl: gh.avatarUrl || null,
        githubScopes: gh.scopes,
        telegramId: null,
        telegramUsername: null,
        telegramFirstName: null,
        telegramLastName: null,
        telegramPhotoUrl: null,
        apiTokenHash: null,
        apiTokenCreatedAt: null,
      });
    } else {
      user.githubLogin = gh.login;
      user.githubAvatarUrl = gh.avatarUrl || null;
      user.githubScopes = gh.scopes;
    }

    return await this.usersRepo.save(user);
  }

  private telegramAuthFromInitData(initData: string): {
    telegramId: string;
    telegramUsername: string | null;
    telegramFirstName: string | null;
    telegramLastName: string | null;
    telegramPhotoUrl: string | null;
  } {
    const data = String(initData || '').trim();
    if (!data) throw new UnauthorizedException('Missing code');

    const params = parse(data);

    const token = this.telegramConfig.token;
    const hmacKey = this.telegramConfig.hmacKey;

    const secretKey = createHmac('sha256', hmacKey).update(token).digest();

    const dataStr = Object.keys(params)
      .filter((key) => key !== 'hash')
      .map((key) => `${key}=${params[key]?.toString()}`)
      .sort()
      .join('\n');

    this.logger.log(
      `Telegram auth attempt. dataStr: ${dataStr.replace(/\n/g, ' | ')}`,
    );

    const checksum = createHmac('sha256', secretKey)
      .update(dataStr)
      .digest('hex');

    const expectedHash =
      typeof params.hash === 'string'
        ? params.hash
        : Array.isArray(params.hash)
          ? params.hash[0]
          : '';

    if (checksum !== expectedHash) {
      this.logger.error(
        `Telegram auth checksum mismatch. Expected: ${expectedHash}, Computed: ${checksum}`,
      );
      this.logger.error(`Data string used for HMAC: ${dataStr}`);
      throw new UnauthorizedException('Invalid code');
    }

    const rawUser = params.user;
    if (!rawUser) throw new UnauthorizedException('Invalid code');

    let userJson: unknown;
    try {
      userJson = JSON.parse(rawUser.toString());
    } catch {
      throw new UnauthorizedException('Invalid code');
    }

    if (!userJson || typeof userJson !== 'object') {
      throw new UnauthorizedException('Invalid code');
    }

    const idRaw = (userJson as { id?: unknown }).id;
    const id =
      typeof idRaw === 'number'
        ? String(idRaw)
        : typeof idRaw === 'string'
          ? idRaw
          : null;
    if (!id) throw new UnauthorizedException('Invalid code');

    const usernameRaw = (userJson as { username?: unknown }).username;
    const firstNameRaw = (userJson as { first_name?: unknown }).first_name;
    const lastNameRaw = (userJson as { last_name?: unknown }).last_name;
    const photoUrlRaw = (userJson as { photo_url?: unknown }).photo_url;

    return {
      telegramId: id,
      telegramUsername: typeof usernameRaw === 'string' ? usernameRaw : null,
      telegramFirstName: typeof firstNameRaw === 'string' ? firstNameRaw : null,
      telegramLastName: typeof lastNameRaw === 'string' ? lastNameRaw : null,
      telegramPhotoUrl: typeof photoUrlRaw === 'string' ? photoUrlRaw : null,
    };
  }

  private async upsertTelegramUser(tg: {
    telegramId: string;
    telegramUsername: string | null;
    telegramFirstName: string | null;
    telegramLastName: string | null;
    telegramPhotoUrl: string | null;
  }): Promise<User> {
    const telegramId = `${tg.telegramId}`;
    let user = await this.usersRepo.findOne({ where: { telegramId } });

    if (!user) {
      user = this.usersRepo.create({
        githubId: null,
        githubLogin: null,
        githubAvatarUrl: null,
        githubScopes: null,
        telegramId,
        telegramUsername: tg.telegramUsername,
        telegramFirstName: tg.telegramFirstName,
        telegramLastName: tg.telegramLastName,
        telegramPhotoUrl: tg.telegramPhotoUrl,
        apiTokenHash: null,
        apiTokenCreatedAt: null,
      });
    } else {
      user.telegramUsername = tg.telegramUsername;
      user.telegramFirstName = tg.telegramFirstName;
      user.telegramLastName = tg.telegramLastName;
      user.telegramPhotoUrl = tg.telegramPhotoUrl;
    }

    return await this.usersRepo.save(user);
  }

  public async logoutApiToken(req: Request, userId: number): Promise<void> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = auth.slice(7);
    if (!token) throw new UnauthorizedException('Missing token');

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const cacheKey = `api:${tokenHash}`;
    await this.cache.del(cacheKey);

    await this.usersRepo.update(
      { id: userId },
      { apiTokenHash: null, apiTokenCreatedAt: null },
    );
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
