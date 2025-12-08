import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  HttpStatus,
  HttpException,
} from '@nestjs/common';

import { CreateTaskDto } from './dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /**
   * Creates a new background task.
   *
   * @param {CreateTaskDto} dto - Task creation data.
   *
   * @returns {Promise<{ taskId: string }>} The created task ID.
   */
  @Post()
  public async createTask(
    @Body() dto: CreateTaskDto,
  ): Promise<{ taskId: string }> {
    const taskId = await this.tasksService.createTask(dto.data);
    return { taskId };
  }

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
   * }>} The task status and related Instagram search profiles.
   */
  @Get(':id')
  public async getTaskStatus(@Param('id') id: string) {
    const { task, instagramProfiles } =
      await this.tasksService.getTaskStatus(id);

    if (!task) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }

    const sanitizedProfiles = instagramProfiles.map(
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
    };
  }
}
