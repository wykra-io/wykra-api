import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { Task, TaskStatus } from '@libs/entities';
import { QueueService } from '@libs/queue';
import { TasksRepository } from '@libs/repositories';

@Injectable()
export class TasksService {
  constructor(
    private readonly queueService: QueueService,
    private readonly tasksRepo: TasksRepository,
  ) {}

  /**
   * Creates a new background task and queues it for processing.
   *
   * @param {string} data - Optional data to process in the task.
   *
   * @returns {Promise<string>} The task ID.
   */
  public async createTask(data?: string): Promise<string> {
    const taskId = randomUUID();

    // Create task record in database
    await this.tasksRepo.create({
      taskId,
      status: TaskStatus.Pending,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
    });

    // Queue the task for processing
    await this.queueService.tasks.add('run-task', {
      taskId,
      data,
    });

    return taskId;
  }

  /**
   * Gets the status of a task by its ID.
   *
   * @param {string} taskId - The task ID.
   *
   * @returns {Promise<Task | null>} The task or null if not found.
   */
  public async getTaskStatus(taskId: string): Promise<Task | null> {
    return this.tasksRepo.findOneByTaskId(taskId);
  }
}

