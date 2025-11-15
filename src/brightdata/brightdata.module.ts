import { Module } from '@nestjs/common';

import { BrightdataConfigModule } from '@libs/config';
import { SentryClientModule } from '@libs/sentry';

import { BrightdataController } from './brightdata.controller';
import { BrightdataService } from './brightdata.service';

@Module({
  imports: [BrightdataConfigModule, SentryClientModule],
  controllers: [BrightdataController],
  providers: [BrightdataService],
  exports: [BrightdataService],
})
export class BrightdataModule {}
