import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Task } from '@libs/entities';

@Injectable()
export class TasksRepository {
  constructor(
    @InjectRepository(Task)
    private readonly repository: Repository<Task>,
  ) {}

  public async create(task: Partial<Task>): Promise<Task> {
    const entity = this.repository.create(task);
    return this.repository.save(entity);
  }

  public async findOneByTaskId(taskId: string): Promise<Task | null> {
    return this.repository.findOne({ where: { taskId } });
  }

  public async update(taskId: string, updates: Partial<Task>): Promise<void> {
    await this.repository.update({ taskId }, updates);
  }
}

