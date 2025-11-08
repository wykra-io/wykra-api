import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  public get env(): string {
    return this.config.getOrThrow<string>('app.env');
  }

  public get isDev(): boolean {
    return this.env === 'development';
  }

  public get isProd(): boolean {
    return this.env === 'production';
  }

  public get host(): string {
    return this.config.getOrThrow<string>('app.host');
  }

  public get port(): number {
    return this.config.getOrThrow<number>('app.port');
  }

  public get globalPrefix(): string {
    return this.config.get<string>('app.globalPrefix', 'api/v1');
  }
}

