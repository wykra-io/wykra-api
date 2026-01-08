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
        order: { createdAt: 'ASC' },
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

  public async update(
    id: number,
    updates: Partial<ChatMessage>,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      await this.repository.update({ id }, updates);
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('update', 'ChatMessage', duration);
    } catch (error) {
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
}

