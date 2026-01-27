import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User, Task, ChatMessage, ChatSession } from '@libs/entities';

import { AdminController } from './admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Task, ChatMessage, ChatSession]),
  ],
  controllers: [AdminController],
})
export class AdminModule {}
