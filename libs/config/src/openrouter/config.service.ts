import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OpenrouterConfigService {
  constructor(private readonly config: ConfigService) {}

  public get apiKey(): string | undefined {
    return this.config.get<string>('openrouter.apiKey');
  }

  public get isConfigured(): boolean {
    return !!this.apiKey;
  }

  public get baseUrl(): string {
    return this.config.get<string>(
      'openrouter.baseUrl',
      'https://openrouter.ai/api/v1',
    );
  }

  public get model(): string {
    return this.config.get<string>(
      'openrouter.model',
      'google/gemini-2.0-flash-001',
    );
  }

  public get timeout(): number {
    return this.config.get<number>('openrouter.timeout', 60000);
  }
}
