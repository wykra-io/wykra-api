import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule } from '@nestjs/throttler';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule, DbConfigModule, DbConfigService } from '@libs/config';
import {
  ChatMessage,
  ChatTask,
  InstagramSearchProfile,
  Task,
  TikTokSearchProfile,
  User,
} from '@libs/entities';
import { SentryClientModule } from '@libs/sentry';

import { AppController } from './app.controller';
import { ApiTokenGuard, ApiTokenThrottlerGuard, AuthModule } from '../auth';
import { BrightdataModule } from '../brightdata';
import { ChatModule } from '../chat';
import { InstagramModule } from '../instagram';
import { TikTokModule } from '../tiktok';
import { MetricsModule, MetricsInterceptor } from '../metrics';
import { PerplexityModule } from '../perplexity';
import { TasksModule } from '../tasks';

@Module({
  imports: [
    AppConfigModule,
    AuthModule,
    BrightdataModule,
    CacheModule.register(),
    ChatModule,
    DbConfigModule,
    EventEmitterModule.forRoot(),
    InstagramModule,
    TikTokModule,
    MetricsModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60 * 60 * 1000, // 1 hour (ms)
        limit: 5,
      },
    ]),
    PerplexityModule,
    SentryClientModule,
    SentryModule.forRoot(),
    TasksModule,
    TypeOrmModule.forRootAsync({
      imports: [DbConfigModule],
      useFactory: (config: DbConfigService) => {
        return {
          type: 'postgres',
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          database: config.database,
          synchronize: config.synchronize,
          logging: config.logging,
          entities: [
            ChatMessage,
            ChatTask,
            Task,
            InstagramSearchProfile,
            TikTokSearchProfile,
            User,
          ],
          ssl: config.ssl,
          retryAttempts: 10,
          retryDelay: 3000,
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
      provide: APP_GUARD,
      useClass: ApiTokenGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ApiTokenThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
})
export class AppModule {}
