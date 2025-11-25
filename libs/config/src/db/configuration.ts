import { registerAs } from '@nestjs/config';
import { env } from 'process';

export default registerAs('db', () => ({
  host: env.DB_HOST || 'localhost',
  port: env.DB_PORT || '5432',
  username: env.DB_USERNAME || 'postgres',
  password: env.DB_PASSWORD || '',
  database: env.DB_DATABASE || 'wykra',
  synchronize: env.DB_SYNCHRONIZE === 'true',
  logging: env.DB_LOGGING === 'true',
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
}));

