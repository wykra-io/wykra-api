import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TlsOptions } from 'tls';

@Injectable()
export class DbConfigService {
  constructor(private readonly config: ConfigService) {}

  public get host(): string {
    return this.config.getOrThrow<string>('db.host');
  }

  public get port(): number {
    return parseInt(this.config.getOrThrow<string>('db.port'), 10);
  }

  public get username(): string {
    return this.config.getOrThrow<string>('db.username');
  }

  public get password(): string {
    return this.config.getOrThrow<string>('db.password');
  }

  public get database(): string {
    return this.config.getOrThrow<string>('db.database');
  }

  public get synchronize(): boolean {
    return this.config.get<boolean>('db.synchronize', false);
  }

  public get logging(): boolean {
    return this.config.get<boolean>('db.logging', false);
  }

  public get ssl(): boolean | TlsOptions {
    return this.config.get<boolean | TlsOptions>('db.ssl', false);
  }
}
