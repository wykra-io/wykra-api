import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosError } from 'axios';

import { BrightdataConfigService, BrightdataDataset } from '@libs/config';
import { SentryClientService } from '@libs/sentry';

import { GoogleSerpDTO } from './dto';
import { GoogleSerpResponse, GoogleSerpResult } from './interfaces';

@Injectable()
export class BrightdataService {
  private readonly logger = new Logger(BrightdataService.name);
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly brightdataConfig: BrightdataConfigService,
    private readonly sentry: SentryClientService,
  ) {
    this.httpClient = axios.create({
      baseURL: this.brightdataConfig.baseUrl,
      timeout: this.brightdataConfig.timeout,
      headers: {
        Authorization: `Bearer ${this.brightdataConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Fetches Google SERP (Search Engine Results Page) data from BrightData.
   *
   * @param {GoogleSerpDTO} dto - The search keyword and optional parameters.
   *
   * @returns {Promise<GoogleSerpResponse>} The SERP results from BrightData.
   */
  public async getGoogleSerp(dto: GoogleSerpDTO): Promise<GoogleSerpResponse> {
    try {
      this.logger.log(`Fetching Google SERP data for keyword: ${dto.keyword}`);

      // BrightData Google SERP API endpoint - using trigger endpoint
      const endpoint = '/datasets/v3/scrape';

      // Request body should be the array directly (not wrapped in trigger_body)
      const requestBody = [
        {
          url: dto.url || 'https://www.google.com/',
          keyword: dto.keyword,
          language: dto.language || 'en',
          country: dto.country || 'US',
          start_page: dto.startPage || 1,
          end_page: dto.endPage || 5,
        },
      ];

      // Query parameters - using Google SERP dataset
      const params = {
        dataset_id: BrightdataDataset.GOOGLE_SERP,
        include_errors: 'true',
      };

      const response = await this.httpClient.post<unknown>(
        endpoint,
        requestBody,
        {
          params,
        },
      );

      this.logger.log(
        `Successfully fetched SERP data for keyword: ${dto.keyword}`,
      );

      // Parse and format the response
      const results = this.parseSerpResponse(response.data);

      return {
        query: dto.keyword,
        results,
      };
    } catch (error) {
      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const status = axiosError.response.status;
        const statusText = axiosError.response.statusText;
        const responseData = axiosError.response.data;

        this.logger.error(
          `BrightData API error for keyword ${dto.keyword}: ${status} - ${statusText}`,
          responseData,
        );

        this.sentry.sendException(error, { keyword: dto.keyword });

        throw new Error(
          `Failed to fetch Google SERP: ${statusText} (${status})`,
        );
      } else if (axiosError.request) {
        this.logger.error(
          `No response from BrightData API for keyword ${dto.keyword}`,
        );

        this.sentry.sendException(error, { keyword: dto.keyword });

        throw new Error('No response from Google SERP API');
      } else {
        this.logger.error(
          `Error setting up request for keyword ${dto.keyword}:`,
          axiosError.message,
        );

        this.sentry.sendException(error, { keyword: dto.keyword });

        throw new Error(`Failed to fetch Google SERP: ${axiosError.message}`);
      }
    }
  }

  /**
   * Parses the BrightData SERP response into a standardized format.
   *
   * @param {unknown} data - The raw response data from BrightData.
   *
   * @returns {GoogleSerpResult[]} Parsed SERP results.
   */
  private parseSerpResponse(data: unknown): GoogleSerpResult[] {
    if (!data || typeof data !== 'object') {
      this.logger.warn('Invalid SERP response data');
      return [];
    }

    const dataObj = data as Record<string, unknown>;

    // BrightData Google SERP response has an 'organic' array with results
    if (Array.isArray(dataObj.organic)) {
      return dataObj.organic.map((item: unknown) => {
        const itemObj = item as Record<string, unknown>;
        return {
          title: (itemObj.title as string) || '',
          url: (itemObj.link as string) || (itemObj.url as string) || '',
          snippet: (itemObj.description as string) || '',
          position: (itemObj.rank as number) || 0,
        };
      });
    }

    // Fallback: handle array response
    if (Array.isArray(data)) {
      return data.map((item, index) => {
        const itemObj = item as Record<string, unknown>;
        return {
          title: (itemObj.title as string) || '',
          url: (itemObj.link as string) || (itemObj.url as string) || '',
          snippet: (itemObj.description as string) || '',
          position: (itemObj.rank as number) || index + 1,
        };
      });
    }

    // Fallback: handle nested results structure
    if (Array.isArray(dataObj.results)) {
      return (dataObj.results as unknown[]).map((item: unknown, index) => {
        const itemObj = item as Record<string, unknown>;
        return {
          title: (itemObj.title as string) || '',
          url: (itemObj.link as string) || (itemObj.url as string) || '',
          snippet: (itemObj.description as string) || '',
          position: (itemObj.rank as number) || index + 1,
        };
      });
    }

    this.logger.warn(
      'Unexpected SERP response format, returning empty results',
    );
    return [];
  }
}
