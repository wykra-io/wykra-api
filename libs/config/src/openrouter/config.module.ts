import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { OpenrouterConfigService } from './config.service';
import openrouterConfiguration from './configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      load: [openrouterConfiguration],
    }),
  ],
  providers: [OpenrouterConfigService],
  exports: [OpenrouterConfigService],
})
export class OpenrouterConfigModule {}
