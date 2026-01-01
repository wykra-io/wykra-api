import { Logger, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule, DbConfigModule, DbConfigService } from '@libs/config';
import {
  InstagramSearchProfile,
  Task,
  TikTokSearchProfile,
} from '@libs/entities';
import { SentryClientModule } from '@libs/sentry';

import { AppController } from './app.controller';
import { BrightdataModule } from '../brightdata';
import { InstagramModule } from '../instagram';
import { TikTokModule } from '../tiktok';
import { MetricsModule, MetricsInterceptor } from '../metrics';
import { PerplexityModule } from '../perplexity';
import { TasksModule } from '../tasks';

@Module({
  imports: [
    AppConfigModule,
    BrightdataModule,
    DbConfigModule,
    EventEmitterModule.forRoot(),
    InstagramModule,
    TikTokModule,
    MetricsModule,
    PerplexityModule,
    SentryClientModule,
    SentryModule.forRoot(),
    TasksModule,
    TypeOrmModule.forRootAsync({
      imports: [DbConfigModule],
      useFactory: (config: DbConfigService) => {
        const logger = new Logger('TypeORM');
        const hasDatabaseUrl = !!process.env.DATABASE_URL;
        logger.log(
          `Connecting to database: ${config.host}:${config.port}/${config.database} as ${config.username} (using ${hasDatabaseUrl ? 'DATABASE_URL' : 'individual vars'})`,
        );

        if (config.host === 'localhost' || config.host === '127.0.0.1') {
          logger.warn(
            '⚠️  WARNING: Attempting to connect to localhost database!',
          );
          logger.warn(
            '   This usually means DATABASE_URL or DB_* variables are not set correctly.',
          );
          logger.warn('   Please check your Railway environment variables.');
          if (!hasDatabaseUrl) {
            logger.warn(
              '   DATABASE_URL is not set. Railway PostgreSQL services provide this automatically when linked.',
            );
            logger.warn(
              '   Go to your app service → Variables tab to verify DATABASE_URL is set.',
            );
            logger.warn(
              '   Or set individual variables: DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE',
            );
          }
        }

        return {
          type: 'postgres',
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          database: config.database,
          synchronize: config.synchronize,
          logging: config.logging,
          entities: [Task, InstagramSearchProfile, TikTokSearchProfile],
          ssl: config.ssl,
          // Add retry configuration for Railway
          retryAttempts: 10,
          retryDelay: 3000,
          // Connection timeout
          connectTimeoutMS: 10000,
        };
      },
      inject: [DbConfigService],
    }),
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
})
export class AppModule {}
