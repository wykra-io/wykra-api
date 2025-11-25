import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Task } from '@libs/entities';
import { QueueModule } from '@libs/queue';
import { TasksRepository } from '@libs/repositories';

import { TasksController } from './tasks.controller';
import { TasksProcessor } from './tasks.processor';
import { TasksService } from './tasks.service';

@Module({
  imports: [TypeOrmModule.forFeature([Task]), QueueModule],
  controllers: [TasksController],
  providers: [TasksService, TasksProcessor, TasksRepository],
})
export class TasksModule {}
