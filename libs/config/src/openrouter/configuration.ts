import { registerAs } from '@nestjs/config';
import { env } from 'node:process';

export default registerAs('openrouter', () => ({
  apiKey: env.OPENROUTER_API_KEY,
  baseUrl: env.OPENROUTER_BASE_URL,
  model: env.OPENROUTER_MODEL,
  timeout: env.OPENROUTER_TIMEOUT
    ? parseInt(env.OPENROUTER_TIMEOUT, 10)
    : 60000,
}));

