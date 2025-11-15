import { Controller, Post, Body } from '@nestjs/common';

import { PerplexitySearchDTO, PerplexitySearchChainDTO } from './dto';
import {
  PerplexityChatResponse,
  PerplexityPromptChainResponse,
} from './interfaces';
import { PerplexityService } from './perplexity.service';

@Controller('perplexity')
export class PerplexityController {
  constructor(private readonly perplexityService: PerplexityService) {}

  /**
   * Searches for micro-influencers on Instagram based on the provided query.
   *
   * @param {PerplexitySearchDTO} dto - The search query describing what influencers to find.
   *
   * @returns {Promise<PerplexityChatResponse>} The response from Perplexity with influencer data in JSON format.
   */
  @Post('search')
  public async search(
    @Body() dto: PerplexitySearchDTO,
  ): Promise<PerplexityChatResponse> {
    return this.perplexityService.search(dto.query);
  }

  /**
   * Gets Instagram hashtags and then finds micro-influencers using those hashtags.
   * Makes two sequential Perplexity calls.
   *
   * @param {PerplexitySearchChainDTO} dto - The search query describing the topic/community to find hashtags for.
   *
   * @returns {Promise<PerplexityPromptChainResponse>} Combined response with hashtags and influencers.
   */
  @Post('search-chain')
  public async searchChain(
    @Body() dto: PerplexitySearchChainDTO,
  ): Promise<PerplexityPromptChainResponse> {
    return this.perplexityService.searchChain(dto.query as string);
  }
}
