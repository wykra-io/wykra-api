import { Controller, Post, Body } from '@nestjs/common';

import { GoogleSerpDTO, GoogleAiModeItemDTO, PerplexitySearchDTO } from './dto';
import {
  GoogleSerpResponse,
  GoogleAiModeResponse,
  PerplexitySearchResponse,
} from './interfaces';
import { BrightdataService } from './brightdata.service';

@Controller('brightdata')
export class BrightdataController {
  constructor(private readonly brightdataService: BrightdataService) {}

  /**
   * Fetches Google SERP (Search Engine Results Page) data from BrightData.
   *
   * @param {GoogleSerpDTO} dto - The search keyword and optional parameters.
   *
   * @returns {Promise<GoogleSerpResponse>} The SERP results from BrightData.
   */
  @Post('google-serp')
  public async getGoogleSerp(
    @Body() dto: GoogleSerpDTO,
  ): Promise<GoogleSerpResponse> {
    return this.brightdataService.getGoogleSerp(dto);
  }

  /**
   * Fetches Google AI Mode data from BrightData.
   *
   * @param {GoogleAiModeItemDTO} dto - Search item with url, prompt, and optional country.
   *
   * @returns {Promise<GoogleAiModeResponse>} The AI Mode results from BrightData.
   */
  @Post('google-ai-mode')
  public async getGoogleAiMode(
    @Body() dto: GoogleAiModeItemDTO,
  ): Promise<GoogleAiModeResponse> {
    return this.brightdataService.getGoogleAiMode(dto);
  }

  /**
   * Fetches Perplexity search data from BrightData.
   *
   * @param {PerplexitySearchDTO} dto - Search item with url, prompt, and optional index.
   *
   * @returns {Promise<PerplexitySearchResponse>} The Perplexity search results from BrightData.
   */
  @Post('perplexity-search')
  public async getPerplexitySearch(
    @Body() dto: PerplexitySearchDTO,
  ): Promise<PerplexitySearchResponse> {
    return this.brightdataService.getPerplexitySearch(dto);
  }
}
