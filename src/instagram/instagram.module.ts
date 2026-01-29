import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BrightdataConfigModule, OpenrouterConfigModule } from '@libs/config';
import { InstagramSearchProfile, Task } from '@libs/entities';
import { QueueModule } from '@libs/queue';
import {
  InstagramSearchProfilesRepository,
  TasksRepository,
} from '@libs/repositories';

import { BrightdataModule } from '../brightdata';
import { MetricsModule, MetricsService } from '../metrics';

import { InstagramController } from './instagram.controller';
import { InstagramProcessor } from './instagram.processor';
import { InstagramService } from './instagram.service';
import { InstagramWebSearchService } from './instagram-web-search.service';

@Module({
  imports: [
    BrightdataConfigModule,
    BrightdataModule,
    OpenrouterConfigModule,
    QueueModule,
    TypeOrmModule.forFeature([Task, InstagramSearchProfile]),
    MetricsModule,
  ],
  controllers: [InstagramController],
  providers: [
    InstagramService,
    InstagramWebSearchService,
    InstagramProcessor,
    TasksRepository,
    InstagramSearchProfilesRepository,
    {
      provide: 'MetricsService',
      useExisting: MetricsService,
    },
  ],
  exports: [InstagramService],
})
export class InstagramModule {}
