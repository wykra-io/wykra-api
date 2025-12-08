import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Task } from '@libs/entities';

// Make MetricsService optional to avoid circular dependency issues
interface IMetricsService {
  recordDbQuery(operation: string, entity: string, duration: number): void;
  recordDbQueryError(
    operation: string,
    entity: string,
    errorType: string,
  ): void;
}

@Injectable()
export class TasksRepository {
  constructor(
    @InjectRepository(Task)
    private readonly repository: Repository<Task>,
    @Optional()
    @Inject('MetricsService')
    private readonly metrics?: IMetricsService,
  ) {}

  public async create(task: Partial<Task>): Promise<Task> {
    const startTime = Date.now();
    try {
      const entity = this.repository.create(task);
      const result = await this.repository.save(entity);
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('create', 'Task', duration);
      return result;
    } catch (error) {
      this.metrics?.recordDbQueryError('create', 'Task', 'save_error');
      throw error;
    }
  }

  public async findOneByTaskId(taskId: string): Promise<Task | null> {
    const startTime = Date.now();
    try {
      const result = await this.repository.findOne({ where: { taskId } });
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('findOne', 'Task', duration);
      return result;
    } catch (error) {
      this.metrics?.recordDbQueryError('findOne', 'Task', 'query_error');
      throw error;
    }
  }

  public async update(taskId: string, updates: Partial<Task>): Promise<void> {
    const startTime = Date.now();
    try {
      await this.repository.update({ taskId }, updates);
      const duration = (Date.now() - startTime) / 1000;
      this.metrics?.recordDbQuery('update', 'Task', duration);
    } catch (error) {
      this.metrics?.recordDbQueryError('update', 'Task', 'update_error');
      throw error;
    }
  }
}
