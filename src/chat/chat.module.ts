import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OpenrouterConfigModule } from '@libs/config';
import { ChatMessage, ChatTask, ChatSession } from '@libs/entities';
import { SentryClientModule } from '@libs/sentry';
import {
  ChatMessagesRepository,
  ChatTasksRepository,
  ChatSessionsRepository,
} from '@libs/repositories';

import { InstagramModule } from '../instagram';
import { MetricsModule } from '../metrics';
import { TasksModule } from '../tasks';
import { TikTokModule } from '../tiktok';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [
    OpenrouterConfigModule,
    SentryClientModule,
    MetricsModule,
    InstagramModule,
    TikTokModule,
    TasksModule,
    TypeOrmModule.forFeature([ChatMessage, ChatTask, ChatSession]),
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatMessagesRepository,
    ChatTasksRepository,
    ChatSessionsRepository,
  ],
  exports: [ChatService],
})
export class ChatModule {}
