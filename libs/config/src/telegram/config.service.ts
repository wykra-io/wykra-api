import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramConfigService {
  constructor(private readonly config: ConfigService) {}

  public get token(): string {
    return this.config.getOrThrow<string>('telegram.token');
  }

  public get hmacKey(): string {
    return this.config.getOrThrow<string>('telegram.hmacKey');
  }
}


