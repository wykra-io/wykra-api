import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PostmarkConfigService {
  constructor(private readonly config: ConfigService) {}

  public get serverToken(): string | undefined {
    return this.config.get<string>('postmark.serverToken');
  }

  public get fromEmail(): string | undefined {
    return this.config.get<string>('postmark.fromEmail');
  }

  public get messageStream(): string {
    return this.config.get<string>('postmark.messageStream', 'outbound');
  }

  public get confirmUrl(): string | undefined {
    return this.config.get<string>('postmark.confirmUrl');
  }

  public get isConfigured(): boolean {
    return !!(this.serverToken && this.fromEmail && this.confirmUrl);
  }
}
