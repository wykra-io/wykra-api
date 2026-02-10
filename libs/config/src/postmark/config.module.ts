import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration from './configuration';
import { PostmarkConfigService } from './config.service';

@Module({
  imports: [ConfigModule.forFeature(configuration)],
  providers: [PostmarkConfigService],
  exports: [PostmarkConfigService],
})
export class PostmarkConfigModule {}
