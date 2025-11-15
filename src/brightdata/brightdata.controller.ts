import { Controller, Post, Body } from '@nestjs/common';

import { GoogleSerpDTO } from './dto';
import { GoogleSerpResponse } from './interfaces';
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
}
