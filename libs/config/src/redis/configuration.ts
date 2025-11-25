import { registerAs } from '@nestjs/config';
import { env } from 'process';

export interface RedisDbs {
  queues: number;
}

export default registerAs('redis', () => ({
  host: env.REDIS_HOST || 'localhost',
  port: env.REDIS_PORT || '6379',
  pass: env.REDIS_PASS || '',
  dbs: {
    queues: parseInt(env.REDIS_DB_QUEUES || '1', 10),
  },
  retryAttempts: parseInt(env.REDIS_RETRY_ATTEMPTS || '10', 10),
  retryDelay: parseInt(env.REDIS_RETRY_DELAY || '30000', 10),
  isCluster: env.REDIS_IS_CLUSTER === 'true',
}));

