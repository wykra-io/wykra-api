import { registerAs } from '@nestjs/config';
import { env } from 'process';

export default registerAs('db', () => {
  if (env.DATABASE_URL) {
    const dbUrl = env.DATABASE_URL.replace(/^postgres:\/\//, 'postgresql://');
    const url = new URL(dbUrl);

    const database = url.pathname.slice(1) || 'postgres';

    const isProduction = env.NODE_ENV === 'production';

    return {
      host: url.hostname,
      port: url.port || '5432',
      username: url.username,
      password: url.password,
      database,
      synchronize: env.DB_SYNCHRONIZE === 'true',
      logging: env.DB_LOGGING === 'true',
      ssl: isProduction ? { rejectUnauthorized: false } : false,
    };
  }

  return {
    host: env.DB_HOST || 'localhost',
    port: env.DB_PORT || '5432',
    username: env.DB_USERNAME || 'postgres',
    password: env.DB_PASSWORD || '',
    database: env.DB_DATABASE || 'wykra',
    synchronize: env.DB_SYNCHRONIZE === 'true',
    logging: env.DB_LOGGING === 'true',
    ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  };
});
