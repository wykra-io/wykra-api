import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ChatTask } from '@libs/entities';

interface IMetricsService {
  recordDbQuery(operation: string, entity: string, duration: number): void;
  recordDbQueryError(
    operation: string,
    entity: string,
    errorType: string,
  ): void;
}

@Injectable()
export class ChatTasksRepository {
  constructor(
    @InjectRepository(ChatTask)
    private readonly repository: Repository<ChatTask>,
    @Optional()
    @Inject('MetricsService')
    private readonly metrics?: IMetricsService,
  ) {}

  public async create(task: Partial<ChatTask>): Promise<ChatTask> {
    const startTime = Date.now();
    try {
      const entity = this.repository.create(task);
      const result = await this.repository.save(entity);
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('create', 'ChatTask', duration);
      return result;
    } catch (error) {
      this.metrics?.recordDbQueryError('create', 'ChatTask', 'save_error');
      throw error;
    }
  }

  public async findByTaskId(taskId: string): Promise<ChatTask | null> {
    const startTime = Date.now();
    try {
      const result = await this.repository.findOne({ where: { taskId } });
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('findByTaskId', 'ChatTask', duration);
      return result;
    } catch (error) {
      this.metrics?.recordDbQueryError(
        'findByTaskId',
        'ChatTask',
        'query_error',
      );
      throw error;
    }
  }

  public async update(
    taskId: string,
    updates: Partial<ChatTask>,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      await this.repository.update({ taskId }, updates);
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('update', 'ChatTask', duration);
    } catch (error) {
      this.metrics?.recordDbQueryError('update', 'ChatTask', 'update_error');
      throw error;
    }
  }
}

