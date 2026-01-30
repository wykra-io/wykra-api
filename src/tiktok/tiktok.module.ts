import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BrightdataConfigModule, OpenrouterConfigModule } from '@libs/config';
import { Task, TikTokSearchProfile } from '@libs/entities';
import { QueueModule } from '@libs/queue';
import {
  TasksRepository,
  TikTokSearchProfilesRepository,
} from '@libs/repositories';

import { MetricsModule, MetricsService } from '../metrics';

import { TikTokController } from './tiktok.controller';
import { TikTokProcessor } from './tiktok.processor';
import { TikTokBrightdataService } from './brightdata/tiktok-brightdata.service';
import { TikTokLLMService } from './llm/tiktok-llm.service';
import { TikTokService } from './tiktok.service';

@Module({
  imports: [
    BrightdataConfigModule,
    CacheModule.register(),
    OpenrouterConfigModule,
    QueueModule,
    TypeOrmModule.forFeature([Task, TikTokSearchProfile]),
    MetricsModule,
  ],
  controllers: [TikTokController],
  providers: [
    TikTokBrightdataService,
    TikTokLLMService,
    TikTokService,
    TikTokProcessor,
    TasksRepository,
    TikTokSearchProfilesRepository,
    {
      provide: 'MetricsService',
      useExisting: MetricsService,
    },
  ],
  exports: [TikTokService],
})
export class TikTokModule {}
