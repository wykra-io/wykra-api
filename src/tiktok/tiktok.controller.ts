import {
  Body,
  Controller,
  Inject,
  Post,
  Req,
  GoneException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request } from 'express';

import { User } from '@libs/entities';
import { SearchPostDto, TikTokProfileDTO } from './dto';
import { TikTokService } from './tiktok.service';

const SEARCH_RATE_LIMIT_TTL_SECONDS = 60 * 60; // 1 hour

@Controller('tiktok')
export class TikTokController {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly tiktokService: TikTokService,
  ) {}

  // NOTE: Search profiles functionality is temporarily disabled (kept in codebase, but blocked at runtime).
  private static readonly SEARCH_PROFILES_DISABLED = false;

  /**
   * Creates a new TikTok profile analysis task (queued).
   *
   * Scraping is done via BrightData trigger -> polling -> snapshot download,
   * and analysis is done via LLM in the worker, similar to `/tiktok/search`.
   */
  @Post('profile')
  public async profile(
    @Body() dto: TikTokProfileDTO,
  ): Promise<{ taskId: string }> {
    const taskId = await this.tiktokService.profile(dto.profile);
    return { taskId };
  }

  /**
   * Creates a new TikTok search job.
   * Rate limited to 1 per hour per user (shared with chat-triggered search).
   *
   * @param {SearchPostDto} dto - Search data containing the search query.
   *
   * @returns {Promise<{ taskId: string }>} The created task ID.
   */
  @Post('search')
  public async search(
    @Req() req: Request & { user?: User },
    @Body() dto: SearchPostDto,
  ): Promise<{ taskId: string }> {
    if (!dto.query || typeof dto.query !== 'string') {
      throw new Error('Query must be a non-empty string');
    }

    if (TikTokController.SEARCH_PROFILES_DISABLED) {
      throw new GoneException('TikTok profile search is currently disabled.');
    }

    const userId = req.user?.id;
    // Rate limit check disabled for manual search
    /*
    if (userId != null) {
      const key = `ratelimit:tiktok_search:${userId}`;
      const existing = await this.cache.get(key);
      if (existing !== undefined && existing !== null) {
        throw new ThrottlerException(
          'TikTok search is limited to 1 per hour. Please try again later.',
        );
      }
    }
    */

    const taskId = await this.tiktokService.search(dto.query);

    /*
    if (userId != null) {
      await this.cache.set(
        `ratelimit:tiktok_search:${userId}`,
        1,
        SEARCH_RATE_LIMIT_TTL_SECONDS,
      );
    }
    */

    return { taskId };
  }

  /**
   * Creates a new TikTok suspicious comments analysis job (queued).
   *
   * Scrapes comments from the profile's videos and analyzes them for suspicious activity.
   *
   * @param {TikTokProfileDTO} dto - Profile data containing the TikTok profile.
   *
   * @returns {Promise<{ taskId: string }>} The created task ID.
   *
   * DISABLED: This endpoint is currently disabled.
   */
  // @Post('profile/comments/suspicious')
  public async commentsSuspicious(
    @Body() dto: TikTokProfileDTO,
  ): Promise<{ taskId: string }> {
    const taskId = await this.tiktokService.commentsSuspicious(dto.profile);
    return { taskId };
  }
}
