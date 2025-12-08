import { Global, Module } from '@nestjs/common';

import { AppConfigModule } from '@libs/config';

import { SentryClientService } from './sentry-client.service';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [SentryClientService],
  exports: [SentryClientService],
})
export class SentryClientModule {}
