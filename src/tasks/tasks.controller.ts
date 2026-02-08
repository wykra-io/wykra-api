import {
  Controller,
  Get,
  Post,
  Param,
  HttpStatus,
  HttpException,
} from '@nestjs/common';

import { SkipThrottle } from '../auth/decorators/skip-throttle.decorator';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /**
   * Gets the status of a task by its ID.
   *
   * @param {string} id - The task ID.
   *
   * @returns {Promise<{
   *   taskId: string;
   *   status: string;
   *   result?: string;
   *   error?: string;
   *   startedAt?: Date;
   *   completedAt?: Date;
   *   instagramProfiles: unknown[];
   *   tiktokProfiles: unknown[];
   * }>} The task status and related Instagram search profiles.
   */
  @SkipThrottle()
  @Get(':id')
  public async getTaskStatus(@Param('id') id: string) {
    const { task, instagramProfiles, tiktokProfiles } =
      await this.tasksService.getTaskStatus(id);

    if (!task) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }

    const sanitizedProfiles = instagramProfiles.map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ raw, ...rest }) => rest,
    );

    const sanitizedTikTokProfiles = tiktokProfiles.map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ raw, ...rest }) => rest,
    );

    return {
      taskId: task.taskId,
      status: task.status,
      result: task.result,
      error: task.error,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      instagramProfiles: sanitizedProfiles,
      tiktokProfiles: sanitizedTikTokProfiles,
    };
  }

  /**
   * Stops (cancels) a running/queued task.
   *
   * Marks the task as cancelled, removes it from queues if still pending,
   * and aborts any in-flight BrightData/OpenRouter calls in this process.
   */
  @Post(':id/stop')
  public async stopTask(@Param('id') id: string) {
    const task = await this.tasksService.stopTask(id);
    return {
      taskId: task.taskId,
      status: task.status,
      error: task.error,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    };
  }
}
