import { Controller, Get, Query } from "@nestjs/common";

import { InstagramAnalysisDTO } from "./dto/instagram-analysis.dto";
import { InstagramAnalysisData } from "./interfaces";
import { InstagramService } from "./instagram.service";

@Controller("instagram")
export class InstagramController {
  constructor(private readonly instagramService: InstagramService) {}

  /**
   * Analyzes an Instagram profile using third-party API and processes results with LLM.
   *
   * @param {InstagramAnalysisDTO} query - Query parameters containing the Instagram profile to analyze.
   *
   * @returns {Promise<InstagramAnalysisData>} Analysis results processed by LLM.
   */
  @Get("analysis")
  public async analyzeProfile(
    @Query() query: InstagramAnalysisDTO,
  ): Promise<InstagramAnalysisData> {
    return this.instagramService.analyzeProfile(query.profile);
  }
}
