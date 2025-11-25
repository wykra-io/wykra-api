import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule, DbConfigModule, DbConfigService } from '@libs/config';
import { Task } from '@libs/entities';
import { SentryClientModule } from '@libs/sentry';

import { AppController } from './app.controller';
import { BrightdataModule } from '../brightdata';
import { InstagramModule } from '../instagram';
import { PerplexityModule } from '../perplexity';
import { TasksModule } from '../tasks';

@Module({
  imports: [
    AppConfigModule,
    BrightdataModule,
    DbConfigModule,
    EventEmitterModule.forRoot(),
    InstagramModule,
    PerplexityModule,
    SentryClientModule,
    SentryModule.forRoot(),
    TasksModule,
    TypeOrmModule.forRootAsync({
      imports: [DbConfigModule],
      useFactory: (config: DbConfigService) => ({
        type: 'postgres',
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        database: config.database,
        synchronize: config.synchronize,
        logging: config.logging,
        entities: [Task],
        ssl: config.ssl,
      }),
      inject: [DbConfigService],
    }),
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
