import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InstagramSearchProfile, Task } from '@libs/entities';
import { QueueModule } from '@libs/queue';
import {
  InstagramSearchProfilesRepository,
  TasksRepository,
} from '@libs/repositories';

import { MetricsModule } from '../metrics';
import { TasksController } from './tasks.controller';
import { TasksProcessor } from './tasks.processor';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, InstagramSearchProfile]),
    QueueModule,
    MetricsModule,
  ],
  controllers: [TasksController],
  providers: [
    TasksService,
    TasksProcessor,
    TasksRepository,
    InstagramSearchProfilesRepository,
  ],
})
export class TasksModule {}
