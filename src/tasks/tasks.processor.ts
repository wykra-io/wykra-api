import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { QueueName } from '@libs/queue';
import { TaskStatus } from '@libs/entities';
import { TasksRepository } from '@libs/repositories';

interface TaskJobData {
  taskId: string;
  data?: string;
}

@Processor(QueueName.Tasks)
export class TasksProcessor {
  private readonly logger = new Logger(TasksProcessor.name);

  constructor(private readonly tasksRepo: TasksRepository) {}

  /**
   * Processes a background task that runs for 1 minute.
   *
   * @param {Job<TaskJobData>} job - A job instance containing task details.
   *
   * @returns void
   */
  @Process('run-task')
  public async runTask(job: Job<TaskJobData>): Promise<void> {
    const { taskId, data } = job.data;

    try {
      // Update task status to running
      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Running,
        startedAt: new Date(),
      });

      this.logger.log(`Task ${taskId} started`);

      // Simulate work for 1 minute (60 seconds)
      const startTime = Date.now();
      const duration = 60 * 1000; // 1 minute in milliseconds

      // Custom logic here - this is where you can add your specific task logic
      // For now, we'll simulate work with periodic updates
      while (Date.now() - startTime < duration) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const remaining = 60 - elapsed;

        if (remaining > 0 && remaining % 10 === 0) {
          this.logger.log(
            `Task ${taskId} progress: ${elapsed}s elapsed, ${remaining}s remaining`,
          );
        }

        // Sleep for 1 second to avoid busy waiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Task completed successfully
      const result = `Task completed successfully. Processed data: ${data || 'no data provided'}`;

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Completed,
        result,
        completedAt: new Date(),
      });

      this.logger.log(`Task ${taskId} completed successfully`);
    } catch (error) {
      this.logger.error(`Task ${taskId} failed: ${error.message}`, error.stack);

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Failed,
        error: error.message,
        completedAt: new Date(),
      });
    }
  }
}
