import { registerAs } from '@nestjs/config';
import { env } from 'node:process';

export default registerAs('brightdata', () => ({
  apiKey: env.BRIGHTDATA_API_KEY,
  baseUrl: env.BRIGHTDATA_BASE_URL,
  timeout: env.BRIGHTDATA_TIMEOUT
    ? parseInt(env.BRIGHTDATA_TIMEOUT, 10)
    : 30000,
}));
