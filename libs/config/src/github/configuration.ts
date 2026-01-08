import { registerAs } from '@nestjs/config';
import { env } from 'node:process';

export default registerAs('github', () => ({
  appClientId: env.GITHUB_APP_CLIENT_ID,
  appClientSecret: env.GITHUB_APP_CLIENT_SECRET,
  appRedirectUri: env.GITHUB_APP_REDIRECT_URI,
  appOauthScopes: env.GITHUB_APP_OAUTH_SCOPES,
  appAllowedRedirectOrigins: (env.GITHUB_APP_ALLOWED_REDIRECT_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
}));
