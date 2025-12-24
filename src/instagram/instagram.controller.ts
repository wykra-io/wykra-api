import { Controller, Get, Post, Query, Body } from '@nestjs/common';

import {
  InstagramAnalysisDTO,
  InstagramProfileDTO,
  SearchPostDto,
} from './dto';
import { InstagramAnalysisData } from './interfaces';
import { InstagramService } from './instagram.service';

@Controller('instagram')
export class InstagramController {
  constructor(private readonly instagramService: InstagramService) {}

  /**
   * Analyzes an Instagram profile using third-party API and processes results with LLM.
   *
   * @param {InstagramAnalysisDTO} query - Query parameters containing the Instagram profile to analyze.
   *
   * @returns {Promise<InstagramAnalysisData>} Analysis results processed by LLM.
   */
  @Get('analysis')
  public async analyzeProfile(
    @Query() query: InstagramAnalysisDTO,
  ): Promise<InstagramAnalysisData> {
    return this.instagramService.analyzeProfile(query.profile);
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
    const taskId = await this.instagramService.search(dto.query);
    return { taskId };
  }

  /**
   * Creates a new Instagram suspicious comments analysis job (queued).
   *
   * Scrapes comments from the profile's recent posts and analyzes them for suspicious activity.
   */
  @Post('profile/comments/suspicious')
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
