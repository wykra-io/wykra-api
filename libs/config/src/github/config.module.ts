import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { GithubConfigService } from './config.service';
import configuration from './configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      load: [configuration],
    }),
  ],
  providers: [GithubConfigService],
  exports: [GithubConfigService],
})
export class GithubConfigModule {}
