import { Controller, Post, Body, GoneException } from '@nestjs/common';

import { InstagramProfileDTO, SearchPostDto } from './dto';
import { InstagramService } from './instagram.service';

@Controller('instagram')
export class InstagramController {
  constructor(private readonly instagramService: InstagramService) {}

  // NOTE: Search profiles functionality is temporarily disabled (kept in codebase, but blocked at runtime).
  private static readonly SEARCH_PROFILES_DISABLED = true;

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
   *
   * @param {SearchPostDto} dto - Search data containing the search query.
   *
   * @returns {Promise<{ taskId: string }>} The created task ID.
   */
  @Post('search')
  public async search(@Body() dto: SearchPostDto): Promise<{ taskId: string }> {
    if (!dto.query || typeof dto.query !== 'string') {
      throw new Error('Query must be a non-empty string');
    }

    if (InstagramController.SEARCH_PROFILES_DISABLED) {
      // Previously: const taskId = await this.instagramService.search(dto.query);
      throw new GoneException(
        'Instagram profile search is currently disabled.',
      );
    }

    const taskId = await this.instagramService.search(dto.query);
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
