import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';

import { AppConfigModule } from '@libs/config';
import { SentryClientModule } from '@libs/sentry';

import { AppController } from './app.controller';
import { BrightdataModule } from '../brightdata';
import { InstagramModule } from '../instagram';
import { PerplexityModule } from '../perplexity';

@Module({
  imports: [
    AppConfigModule,
    BrightdataModule,
    EventEmitterModule.forRoot(),
    InstagramModule,
    PerplexityModule,
    SentryClientModule,
    SentryModule.forRoot(),
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
