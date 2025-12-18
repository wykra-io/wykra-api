import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from '@libs/queue';
import { MetricsService } from './metrics.service';

@Injectable()
export class QueueMetricsService implements OnModuleInit {
  private readonly logger = new Logger(QueueMetricsService.name);
  private intervalId?: NodeJS.Timeout;

  constructor(
    private readonly queueService: QueueService,
    private readonly metricsService: MetricsService,
  ) {}

  onModuleInit() {
    // Start updating queue metrics every 10 seconds
    this.startMetricsUpdater();
  }

  private startMetricsUpdater(): void {
    this.logger.log('Starting queue metrics updater (every 10 seconds)');

    // Update immediately on start
    this.updateQueueMetrics().catch((error) => {
      this.logger.error('Failed to update queue metrics on init', error);
    });

    // Then update every 10 seconds
    this.intervalId = setInterval(() => {
      this.updateQueueMetrics().catch((error) => {
        this.logger.error('Failed to update queue metrics', error);
      });
    }, 10000);
  }

  private async updateQueueMetrics(): Promise<void> {
    try {
      // Update Instagram queue size
      const instagramWaiting =
        await this.queueService.instagram.getWaitingCount();
      const instagramActive =
        await this.queueService.instagram.getActiveCount();
      const instagramDelayed =
        await this.queueService.instagram.getDelayedCount();

      const instagramTotal =
        instagramWaiting + instagramActive + instagramDelayed;
      this.metricsService.setTaskQueueSize('instagram', instagramTotal);

      // Update Tasks queue size
      const tasksWaiting = await this.queueService.tasks.getWaitingCount();
      const tasksActive = await this.queueService.tasks.getActiveCount();
      const tasksDelayed = await this.queueService.tasks.getDelayedCount();

      const tasksTotal = tasksWaiting + tasksActive + tasksDelayed;
      this.metricsService.setTaskQueueSize('tasks', tasksTotal);

      // this.logger.debug(
      //   `Queue sizes - Instagram: ${instagramTotal} (${instagramWaiting}W/${instagramActive}A/${instagramDelayed}D), Tasks: ${tasksTotal} (${tasksWaiting}W/${tasksActive}A/${tasksDelayed}D)`,
      // );
    } catch (error) {
      this.logger.error('Error updating queue metrics', error);
      throw error;
    }
  }

  // Cleanup on module destroy
  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.logger.log('Stopped queue metrics updater');
    }
  }
}
