import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BrightdataConfigService {
  constructor(private readonly config: ConfigService) {}

  public get apiKey(): string {
    return this.config.getOrThrow<string>('brightdata.apiKey');
  }

  public get baseUrl(): string {
    return this.config.get<string>(
      'brightdata.baseUrl',
      'https://api.brightdata.com',
    );
  }

  public get timeout(): number {
    return this.config.get<number>('brightdata.timeout', 30000);
  }
}
