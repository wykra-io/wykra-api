import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ChatSession } from '@libs/entities';

interface IMetricsService {
  recordDbQuery(operation: string, entity: string, duration: number): void;
  recordDbQueryError(
    operation: string,
    entity: string,
    errorType: string,
  ): void;
}

@Injectable()
export class ChatSessionsRepository {
  constructor(
    @InjectRepository(ChatSession)
    private readonly repository: Repository<ChatSession>,
    @Optional()
    @Inject('MetricsService')
    private readonly metrics?: IMetricsService,
  ) {}

  public async create(
    session: Partial<ChatSession>,
  ): Promise<ChatSession> {
    const startTime = Date.now();
    try {
      const entity = this.repository.create(session);
      const result = await this.repository.save(entity);
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('create', 'ChatSession', duration);
      return result;
    } catch (error) {
      this.metrics?.recordDbQueryError(
        'create',
        'ChatSession',
        'save_error',
      );
      throw error;
    }
  }

  public async findByUserId(userId: number): Promise<ChatSession[]> {
    const startTime = Date.now();
    try {
      const result = await this.repository.find({
        where: { userId },
        order: { createdAt: 'DESC' },
      });
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('find', 'ChatSession', duration);
      return result;
    } catch (error) {
      this.metrics?.recordDbQueryError(
        'find',
        'ChatSession',
        'query_error',
      );
      throw error;
    }
  }
}

