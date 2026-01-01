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
    const port = this.config.get<string | number>('app.port');
    if (port === undefined) {
      return 3000; // Default fallback
    }
    return typeof port === 'string' ? parseInt(port, 10) : port;
  }

  public get globalPrefix(): string {
    return this.config.get<string>('app.globalPrefix', 'api/v1');
  }
}
