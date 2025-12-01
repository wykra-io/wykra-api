import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BrightdataConfigModule, OpenrouterConfigModule } from '@libs/config';
import { InstagramSearchProfile, Task } from '@libs/entities';
import { QueueModule } from '@libs/queue';
import {
  InstagramSearchProfilesRepository,
  TasksRepository,
} from '@libs/repositories';

import { PerplexityModule } from '../perplexity';

import { InstagramController } from './instagram.controller';
import { InstagramProcessor } from './instagram.processor';
import { InstagramService } from './instagram.service';

@Module({
  imports: [
    BrightdataConfigModule,
    OpenrouterConfigModule,
    QueueModule,
    TypeOrmModule.forFeature([Task, InstagramSearchProfile]),
    PerplexityModule,
  ],
  controllers: [InstagramController],
  providers: [
    InstagramService,
    InstagramProcessor,
    TasksRepository,
    InstagramSearchProfilesRepository,
  ],
  exports: [InstagramService],
})
export class InstagramModule {}
