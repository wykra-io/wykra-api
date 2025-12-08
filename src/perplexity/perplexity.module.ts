import { Module } from '@nestjs/common';

import { OpenrouterConfigModule } from '@libs/config';
import { SentryClientModule } from '@libs/sentry';

import { MetricsModule } from '../metrics';
import { PerplexityController } from './perplexity.controller';
import { PerplexityService } from './perplexity.service';

@Module({
  imports: [OpenrouterConfigModule, SentryClientModule, MetricsModule],
  controllers: [PerplexityController],
  providers: [PerplexityService],
  exports: [PerplexityService],
})
export class PerplexityModule {}
