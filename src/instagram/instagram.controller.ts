import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request } from 'express';

import { User } from '@libs/entities';
import { InstagramProfileDTO, SearchPostDto } from './dto';
import { InstagramService } from './instagram.service';

const SEARCH_RATE_LIMIT_TTL_SECONDS = 60 * 60; // 1 hour

@Controller('instagram')
export class InstagramController {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly instagramService: InstagramService,
  ) {}

  /**
   * Creates a new Instagram profile analysis task (queued).
   *
   * @param {InstagramProfileDTO} dto - Profile data containing the Instagram profile to analyze.
   *
   * @returns {Promise<{ taskId: string }>} The created task ID.
   */
  @Post('analysis')
  public async analyzeProfile(
    @Body() dto: InstagramProfileDTO,
  ): Promise<{ taskId: string }> {
    const taskId = await this.instagramService.profile(dto.profile);
    return { taskId };
  }

  /**
   * Creates a new Instagram search job.
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

    const userId = req.user?.id;
    const taskId = await this.instagramService.search(dto.query, userId);

    /*
    if (userId != null) {
      await this.cache.set(
        `ratelimit:instagram_search:${userId}`,
        1,
        SEARCH_RATE_LIMIT_TTL_SECONDS,
      );
    }
    */

    return { taskId };
  }

  /**
   * Creates a new Instagram suspicious comments analysis job (queued).
   *
   * Scrapes comments from the profile's recent posts and analyzes them for suspicious activity.
   *
   * DISABLED: This endpoint is currently disabled.
   */
  // @Post('profile/comments/suspicious')
  public async commentsSuspicious(
    @Body() dto: InstagramProfileDTO,
  ): Promise<{ taskId: string }> {
    const profile = String(dto.profile ?? '').trim();
    if (!profile) {
      throw new Error('Profile must be a non-empty string');
    }
    const taskId = await this.instagramService.commentsSuspicious(profile);
    return { taskId };
  }
}
