import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import configuration from './configuration';
import { RedisConfigService } from './config.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      load: [configuration],
    }),
  ],
  providers: [ConfigService, RedisConfigService],
  exports: [ConfigService, RedisConfigService],
})
export class RedisConfigModule {}

