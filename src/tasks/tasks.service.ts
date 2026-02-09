import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'crypto';

import {
  InstagramSearchProfile,
  Task,
  TaskStatus,
  TikTokSearchProfile,
} from '@libs/entities';
import { QueueService } from '@libs/queue';
import {
  InstagramSearchProfilesRepository,
  TasksRepository,
  TikTokSearchProfilesRepository,
} from '@libs/repositories';
import { MetricsService } from '../metrics';
import { TaskCancellationService } from './task-cancellation.service';

@Injectable()
export class TasksService {
  constructor(
    private readonly queueService: QueueService,
    private readonly tasksRepo: TasksRepository,
    private readonly instagramSearchProfilesRepo: InstagramSearchProfilesRepository,
    private readonly tiktokSearchProfilesRepo: TikTokSearchProfilesRepository,
    private readonly metricsService: MetricsService,
    private readonly taskCancellation: TaskCancellationService,
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
    await this.queueService.tasks.add(
      'run-task',
      {
        taskId,
        data,
      },
      { jobId: taskId },
    );

    // Record task creation metric
    this.metricsService.recordTaskCreated('generic');

    return taskId;
  }

  public async stopTask(taskId: string): Promise<Task> {
    const task = await this.tasksRepo.findOneByTaskId(taskId);
    console.log(`stopTask called for taskId: ${taskId}`, { status: task?.status });
    if (!task) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }

    if (
      task.status === TaskStatus.Completed ||
      task.status === TaskStatus.Failed ||
      task.status === TaskStatus.Cancelled
    ) {
      return task;
    }

    // Update status to Cancelled immediately to unblock polling and UI.
    const completedAt = new Date();
    await this.tasksRepo.update(taskId, {
      status: TaskStatus.Cancelled,
      error: 'Cancelled by user',
      completedAt,
    });

    // Abort in-flight work in this process (BrightData/OpenRouter).
    this.taskCancellation.abort(taskId, new Error('Task cancelled by user'));

    // Remove pending jobs from queues (works when jobId === taskId).
    await Promise.allSettled([
      this.queueService.tasks
        .getJob(taskId)
        .then((job) => job?.remove())
        .catch(() => undefined),
      this.queueService.instagram
        .getJob(taskId)
        .then((job) => job?.remove())
        .catch(() => undefined),
      this.queueService.tiktok
        .getJob(taskId)
        .then((job) => job?.remove())
        .catch(() => undefined),
    ]);

    // Best-effort: return updated task shape
    return {
      ...task,
      status: TaskStatus.Cancelled,
      error: 'Cancelled by user',
      completedAt,
    };
  }

  /**
   * Gets the status of a task by its ID, including any related Instagram search profiles.
   *
   * @param {string} taskId - The task ID.
   *
   * @returns {Promise<{ task: Task | null; instagramProfiles: InstagramSearchProfile[]; tiktokProfiles: TikTokSearchProfile[] }>}
   * The task and its related Instagram/TikTok search profiles.
   */
  public async getTaskStatus(taskId: string): Promise<{
    task: Task | null;
    instagramProfiles: InstagramSearchProfile[];
    tiktokProfiles: TikTokSearchProfile[];
  }> {
    const [task, instagramProfiles, tiktokProfiles] = await Promise.all([
      this.tasksRepo.findOneByTaskId(taskId),
      this.instagramSearchProfilesRepo.findByTaskId(taskId),
      this.tiktokSearchProfilesRepo.findByTaskId(taskId),
    ]);

    return { task, instagramProfiles, tiktokProfiles };
  }
}
