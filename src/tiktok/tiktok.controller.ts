import { Body, Controller, Post } from '@nestjs/common';

import { SearchPostDto, TikTokProfileDTO } from './dto';
import { TikTokService } from './tiktok.service';

@Controller('tiktok')
export class TikTokController {
  constructor(private readonly tiktokService: TikTokService) {}

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
    const taskId = await this.tiktokService.search(dto.query);
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
   */
  @Post('profile/comments/suspicious')
  public async commentsSuspicious(
    @Body() dto: TikTokProfileDTO,
  ): Promise<{ taskId: string }> {
    const taskId = await this.tiktokService.commentsSuspicious(dto.profile);
    return { taskId };
  }
}
