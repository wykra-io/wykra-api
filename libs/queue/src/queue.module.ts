import { BullModule } from '@nestjs/bull';
import { Global, Module } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';

import { RedisConfigModule, RedisConfigService } from '@libs/config';
import { QueueName } from './enums';

import { QueueService } from './queue.service';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [RedisConfigModule],
      useFactory: (config: RedisConfigService) => ({
        prefix: '{wykra}',
        redis: {
          host: config.host,
          port: config.port,
          password: config.password,
          db: config.dbs.queues,
        },
        defaultJobOptions: {
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 3,
        },
        createClient(type, redisOpts: RedisOptions) {
          const opts: RedisOptions = { ...redisOpts };

          if (['bclient', 'subscriber'].includes(type)) {
            opts.enableReadyCheck = false;
            opts.maxRetriesPerRequest = null;
          }

          return config.isCluster
            ? new Redis.Cluster([{ host: opts.host, port: opts.port }], opts)
            : new Redis(opts);
        },
      }),
      inject: [RedisConfigService],
    }),
    BullModule.registerQueue({ name: QueueName.Tasks }),
    BullModule.registerQueue({ name: QueueName.Instagram }),
  ],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
