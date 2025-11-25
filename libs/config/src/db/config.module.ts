import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import configuration from './configuration';
import { DbConfigService } from './config.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      load: [configuration],
    }),
  ],
  providers: [ConfigService, DbConfigService],
  exports: [ConfigService, DbConfigService],
})
export class DbConfigModule {}

