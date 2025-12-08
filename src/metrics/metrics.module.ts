import { Module } from '@nestjs/common';
import { QueueModule } from '@libs/queue';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { QueueMetricsService } from './queue-metrics.service';

@Module({
  imports: [QueueModule],
  controllers: [MetricsController],
  providers: [MetricsService, QueueMetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
