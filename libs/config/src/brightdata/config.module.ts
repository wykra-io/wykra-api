import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { BrightdataConfigService } from './config.service';
import brightdataConfiguration from './configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      load: [brightdataConfiguration],
    }),
  ],
  providers: [BrightdataConfigService],
  exports: [BrightdataConfigService],
})
export class BrightdataConfigModule {}
