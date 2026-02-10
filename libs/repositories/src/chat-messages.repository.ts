import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ChatMessage } from '@libs/entities';

interface IMetricsService {
  recordDbQuery(operation: string, entity: string, duration: number): void;
  recordDbQueryError(
    operation: string,
    entity: string,
    errorType: string,
  ): void;
}

@Injectable()
export class ChatMessagesRepository {
  constructor(
    @InjectRepository(ChatMessage)
    private readonly repository: Repository<ChatMessage>,
    @Optional()
    @Inject('MetricsService')
    private readonly metrics?: IMetricsService,
  ) {}

  public async create(message: Partial<ChatMessage>): Promise<ChatMessage> {
    const startTime = Date.now();
    try {
      const entity = this.repository.create(message);
      const result = await this.repository.save(entity);
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('create', 'ChatMessage', duration);
      return result;
    } catch (error) {
      this.metrics?.recordDbQueryError('create', 'ChatMessage', 'save_error');
      throw error;
    }
  }

  public async findByUserId(userId: number): Promise<ChatMessage[]> {
    const startTime = Date.now();
    try {
      const result = await this.repository.find({
        where: { userId },
        order: { clientCreatedAt: 'ASC', id: 'ASC' },
      });
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('findByUserId', 'ChatMessage', duration);
      return result;
    } catch (error) {
      this.metrics?.recordDbQueryError(
        'findByUserId',
        'ChatMessage',
        'query_error',
      );
      throw error;
    }
  }

  public async findById(id: number): Promise<ChatMessage | null> {
    const startTime = Date.now();
    try {
      const result = await this.repository.findOne({ where: { id } });
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('findById', 'ChatMessage', duration);
      return result;
    } catch (error) {
      this.metrics?.recordDbQueryError('findById', 'ChatMessage', 'query_error');
      throw error;
    }
  }

  public async findByUserIdAndSessionId(
    userId: number,
    sessionId: number,
  ): Promise<ChatMessage[]> {
    const startTime = Date.now();
    try {
      console.log(`ChatMessagesRepository.findByUserIdAndSessionId: userId=${userId}, sessionId=${sessionId}`);
      const result = await this.repository.find({
        where: { userId, sessionId },
        order: { clientCreatedAt: 'ASC', id: 'ASC' },
      });
      console.log(`ChatMessagesRepository.findByUserIdAndSessionId success: found ${result.length} messages`);
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery(
        'findByUserIdAndSessionId',
        'ChatMessage',
        duration,
      );
      return result;
    } catch (error) {
      console.error(`ChatMessagesRepository.findByUserIdAndSessionId error: ${error instanceof Error ? error.message : String(error)}`);
      this.metrics?.recordDbQueryError(
        'findByUserIdAndSessionId',
        'ChatMessage',
        'query_error',
      );
      throw error;
    }
  }

  public async update(
    id: number,
    updates: Partial<ChatMessage>,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      console.log(`ChatMessagesRepository.update: id=${id}, updates=${JSON.stringify(updates).substring(0, 100)}`);
      // Use save instead of update to ensure subscribers/hooks are triggered and 
      // because update() in TypeORM can sometimes be finicky with complex entities.
      const entity = await this.repository.findOne({ where: { id } });
      if (entity) {
        Object.assign(entity, updates);
        const saved = await this.repository.save(entity);
        console.log(`ChatMessagesRepository.update success: id=${id}, savedContentLen=${saved.content.length}`);
      } else {
        console.warn(`ChatMessagesRepository.update: entity ${id} not found`);
        // Fallback to regular update if entity not found (shouldn't happen)
        await this.repository.update({ id }, updates);
      }
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('update', 'ChatMessage', duration);
    } catch (error) {
      console.error(`ChatMessagesRepository.update error: ${error instanceof Error ? error.message : String(error)}`);
      this.metrics?.recordDbQueryError('update', 'ChatMessage', 'update_error');
      throw error;
    }
  }

  public async deleteByUserId(userId: number): Promise<void> {
    const startTime = Date.now();
    try {
      await this.repository.delete({ userId });
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('deleteByUserId', 'ChatMessage', duration);
    } catch (error) {
      this.metrics?.recordDbQueryError(
        'deleteByUserId',
        'ChatMessage',
        'delete_error',
      );
      throw error;
    }
  }

  public async deleteByUserIdAndSessionId(
    userId: number,
    sessionId: number,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      await this.repository.delete({ userId, sessionId });
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery(
        'deleteByUserIdAndSessionId',
        'ChatMessage',
        duration,
      );
    } catch (error) {
      this.metrics?.recordDbQueryError(
        'deleteByUserIdAndSessionId',
        'ChatMessage',
        'delete_error',
      );
      throw error;
    }
  }
}
