import * as dotenv from 'dotenv';
import { env } from 'process';
import { DataSource } from 'typeorm';

dotenv.config();

export default new DataSource({
  type: 'postgres',
  host: env.DB_HOST,
  port: env.DB_PORT ? parseInt(env.DB_PORT, 10) : 5432,
  username: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  database: env.DB_DATABASE,
  synchronize: false,
  logging: false,
  migrations: ['db/migrations/**/*.ts'],
});
