import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GithubConfigService {
  constructor(private readonly config: ConfigService) {}

  public get appClientId(): string | undefined {
    return this.config.get<string>('github.appClientId');
  }

  public get appClientSecret(): string | undefined {
    return this.config.get<string>('github.appClientSecret');
  }

  public get appRedirectUri(): string | undefined {
    return this.config.get<string>('github.appRedirectUri');
  }

  /**
   * Comma- or space-separated list accepted in env; this returns a space-separated string
   * as GitHub expects in the `scope` query param.
   */
  public get appOauthScopes(): string | undefined {
    const raw = this.config.get<string>('github.appOauthScopes');
    if (!raw) return undefined;
    return raw
      .split(/[\s,]+/g)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ');
  }

  public get appAllowedRedirectOrigins(): string[] {
    return this.config.get<string[]>('github.appAllowedRedirectOrigins', []);
  }

  public get isAppOauthConfigured(): boolean {
    return !!(this.appClientId && this.appClientSecret && this.appRedirectUri);
  }
}
