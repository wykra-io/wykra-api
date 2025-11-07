import { registerAs } from '@nestjs/config';
import { env } from 'node:process';

export default registerAs('app', () => ({
  env: env.NODE_ENV,
  host: env.APP_HOST,
  port: env.APP_PORT,
  globalPrefix: env.APP_GLOBAL_PREFIX,
  secretKey: env.APP_SECRET_KEY,
}));

