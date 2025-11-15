import { Controller, Post, Body } from '@nestjs/common';

import { PerplexitySearchDTO } from './dto';
import {
  PerplexityChatResponse,
  PerplexityPromptChainResponse,
} from './interfaces';
import { PerplexityService } from './perplexity.service';

@Controller('perplexity')
export class PerplexityController {
  constructor(private readonly perplexityService: PerplexityService) {}

  /**
   * Finds micro-influencers on Instagram who post about tech gadgets and AI tools.
   *
   * @param {PerplexitySearchDTO} dto - Optional model selection.
   *
   * @returns {Promise<PerplexityChatResponse>} The response from Perplexity with influencer data in JSON format.
   */
  @Post('find-as-discovery-engine')
  public async findAsDiscoveryEngine(
    @Body() dto: PerplexitySearchDTO,
  ): Promise<PerplexityChatResponse> {
    return this.perplexityService.findAsDiscoveryEngine(dto.model);
  }

  /**
   * Gets Instagram hashtags and then finds micro-influencers using those hashtags.
   * Makes two sequential Perplexity calls.
   *
   * @param {PerplexitySearchDTO} dto - Optional model selection.
   *
   * @returns {Promise<PerplexityPromptChainResponse>} Combined response with hashtags and influencers.
   */
  @Post('prompt-chain')
  public async promptChain(
    @Body() dto: PerplexitySearchDTO,
  ): Promise<PerplexityPromptChainResponse> {
    return this.perplexityService.promptChain(dto.model);
  }
}
