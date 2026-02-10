import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '@libs/entities/user.entity';
import {
  GithubConfigModule,
  PostmarkConfigModule,
  TelegramConfigModule,
} from '@libs/config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    // In-memory cache (default). This satisfies the 5-min token cache requirement.
    CacheModule.register(),
    GithubConfigModule,
    PostmarkConfigModule,
    TelegramConfigModule,
    TypeOrmModule.forFeature([User]),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
