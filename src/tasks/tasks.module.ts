import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  InstagramSearchProfile,
  Task,
  TikTokSearchProfile,
} from '@libs/entities';
import { QueueModule } from '@libs/queue';
import {
  InstagramSearchProfilesRepository,
  TasksRepository,
  TikTokSearchProfilesRepository,
} from '@libs/repositories';

import { MetricsModule, MetricsService } from '../metrics';
import { TasksController } from './tasks.controller';
import { TasksProcessor } from './tasks.processor';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Task,
      InstagramSearchProfile,
      TikTokSearchProfile,
    ]),
    QueueModule,
    MetricsModule,
  ],
  controllers: [TasksController],
  providers: [
    TasksService,
    TasksProcessor,
    TasksRepository,
    InstagramSearchProfilesRepository,
    TikTokSearchProfilesRepository,
    {
      provide: 'MetricsService',
      useExisting: MetricsService,
    },
  ],
})
export class TasksModule {}
