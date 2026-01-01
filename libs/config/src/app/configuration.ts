import { registerAs } from '@nestjs/config';
import { env } from 'node:process';

export default registerAs('app', () => ({
  env: env.NODE_ENV,
  host: env.APP_HOST || '0.0.0.0',
  port: env.PORT || env.APP_PORT || '3000',
  globalPrefix: env.APP_GLOBAL_PREFIX,
}));
