import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisDbs } from './configuration';

@Injectable()
export class RedisConfigService {
  constructor(private readonly config: ConfigService) {}

  public get host(): string {
    return this.config.getOrThrow<string>('redis.host');
  }

  public get port(): number {
    return parseInt(this.config.getOrThrow<string>('redis.port'), 10);
  }

  public get password(): string | undefined {
    return this.config.get<string>('redis.pass');
  }

  public get dbs(): RedisDbs {
    return this.config.getOrThrow<RedisDbs>('redis.dbs');
  }

  public get retryAttempts(): number {
    return this.config.getOrThrow<number>('redis.retryAttempts');
  }

  public get retryDelay(): number {
    return this.config.getOrThrow<number>('redis.retryDelay');
  }

  public get url(): string {
    const password = this.password ? `:${this.password}@` : '';
    return `redis://${password}${this.host}:${this.port}`;
  }

  public get isCluster(): boolean {
    return this.config.getOrThrow<boolean>('redis.isCluster');
  }
}
