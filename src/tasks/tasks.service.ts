import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { InstagramSearchProfile, Task, TaskStatus } from '@libs/entities';
import { QueueService } from '@libs/queue';
import {
  InstagramSearchProfilesRepository,
  TasksRepository,
} from '@libs/repositories';
import { MetricsService } from '../metrics';

@Injectable()
export class TasksService {
  constructor(
    private readonly queueService: QueueService,
    private readonly tasksRepo: TasksRepository,
    private readonly instagramSearchProfilesRepo: InstagramSearchProfilesRepository,
    private readonly metricsService: MetricsService,
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

    // Record task creation metric
    this.metricsService.recordTaskCreated('generic');

    return taskId;
  }

  /**
   * Gets the status of a task by its ID, including any related Instagram search profiles.
   *
   * @param {string} taskId - The task ID.
   *
   * @returns {Promise<{ task: Task | null; instagramProfiles: InstagramSearchProfile[] }>}
   * The task and its related Instagram search profiles.
   */
  public async getTaskStatus(taskId: string): Promise<{
    task: Task | null;
    instagramProfiles: InstagramSearchProfile[];
  }> {
    const [task, instagramProfiles] = await Promise.all([
      this.tasksRepo.findOneByTaskId(taskId),
      this.instagramSearchProfilesRepo.findByTaskId(taskId),
    ]);

    return { task, instagramProfiles };
  }
}
