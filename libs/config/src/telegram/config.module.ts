import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import configuration from './configuration';
import { TelegramConfigService } from './config.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      load: [configuration],
    }),
  ],
  providers: [ConfigService, TelegramConfigService],
  exports: [TelegramConfigService],
})
export class TelegramConfigModule {}
