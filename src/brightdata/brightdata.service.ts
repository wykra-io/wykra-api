import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosError } from 'axios';

import { BrightdataConfigService, BrightdataDataset } from '@libs/config';
import { SentryClientService } from '@libs/sentry';

import { MetricsService } from '../metrics';
import { GoogleSerpDTO, GoogleAiModeItemDTO, PerplexitySearchDTO } from './dto';
import {
  GoogleSerpResponse,
  GoogleSerpResult,
  GoogleAiModeResponse,
  PerplexitySearchResponse,
} from './interfaces';

@Injectable()
export class BrightdataService {
  private readonly logger = new Logger(BrightdataService.name);
  private readonly httpClient: AxiosInstance | null;

  constructor(
    private readonly brightdataConfig: BrightdataConfigService,
    private readonly sentry: SentryClientService,
    private readonly metricsService: MetricsService,
  ) {
    if (this.brightdataConfig.isConfigured) {
      this.httpClient = axios.create({
        baseURL: this.brightdataConfig.baseUrl,
        timeout: this.brightdataConfig.timeout,
        headers: {
          Authorization: `Bearer ${this.brightdataConfig.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
    } else {
      this.httpClient = null;
      this.logger.warn(
        'BrightData API key not configured. BrightData features will be unavailable.',
      );
    }
  }

  private ensureHttpClient(): AxiosInstance {
    if (!this.httpClient) {
      throw new Error(
        'BrightData API key is not configured. Please set BRIGHTDATA_API_KEY environment variable.',
      );
    }
    return this.httpClient;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) return this.sleep(ms);
    if (signal.aborted) {
      throw new Error('Aborted');
    }
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        signal.removeEventListener('abort', onAbort);
        reject(new Error('Aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Default wait timeout: 20 minutes. Poll/status and download calls use retries. */
  private static readonly ASYNC_WAIT_TIMEOUT_MS = 20 * 60 * 1000;
  private static readonly ASYNC_POLL_INTERVAL_MS = 5000;
  private static readonly ASYNC_MAX_RETRIES = 3;
  private static readonly ASYNC_RETRY_DELAY_MS = 2000;

  /**
   * Waits for a snapshot to be ready (Monitor Progress) then downloads it (Download Snapshot).
   * Use when a synchronous scrape returns "still in progress" with a snapshot_id.
   *
   * @param snapshotId - Snapshot ID from Bright Data scrape/trigger response.
   * @param opts - Optional timeout, poll interval, and retries (defaults: 20 min, 5s, 3).
   * @returns Raw snapshot payload (array or object; caller normalizes as needed).
   */
  public async waitAndDownloadSnapshot(
    snapshotId: string,
    opts?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      maxRetries?: number;
      signal?: AbortSignal;
    },
  ): Promise<unknown> {
    const timeoutMs =
      opts?.timeoutMs ?? BrightdataService.ASYNC_WAIT_TIMEOUT_MS;
    const pollIntervalMs =
      opts?.pollIntervalMs ?? BrightdataService.ASYNC_POLL_INTERVAL_MS;
    const maxRetries = opts?.maxRetries ?? BrightdataService.ASYNC_MAX_RETRIES;
    const signal = opts?.signal;

    await this.waitForSnapshotWithRetries(snapshotId, {
      timeoutMs,
      pollIntervalMs,
      maxRetries,
      signal,
    });

    return this.downloadSnapshotWithRetries(snapshotId, maxRetries, signal);
  }

  /**
   * Async flow: trigger → poll progress until ready → download snapshot.
   * Uses long timeout (20 min) and retries on progress/download errors so tasks do not fail on transient issues.
   */
  public async runDatasetTriggerAndDownload(
    datasetId: BrightdataDataset | string,
    triggerBody: unknown[],
    params: Record<string, string>,
    metricName: string,
    opts?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      maxRetries?: number;
      signal?: AbortSignal;
    },
  ): Promise<unknown[]> {
    const startTime = Date.now();
    const timeoutMs =
      opts?.timeoutMs ?? BrightdataService.ASYNC_WAIT_TIMEOUT_MS;
    const pollIntervalMs =
      opts?.pollIntervalMs ?? BrightdataService.ASYNC_POLL_INTERVAL_MS;
    const maxRetries = opts?.maxRetries ?? BrightdataService.ASYNC_MAX_RETRIES;
    const signal = opts?.signal;

    try {
      const { snapshot_id } = await this.triggerDatasetWithRetries(
        datasetId,
        triggerBody,
        { include_errors: 'true', ...params },
        maxRetries,
        signal,
      );

      await this.waitForSnapshotWithRetries(snapshot_id, {
        timeoutMs,
        pollIntervalMs,
        maxRetries,
        signal,
      });

      const downloaded = await this.downloadSnapshotWithRetries(
        snapshot_id,
        maxRetries,
        signal,
      );

      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordBrightdataCall(
        String(datasetId),
        metricName,
        duration,
      );

      return this.normalizeSnapshotToArray(downloaded);
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordBrightdataCall(
        String(datasetId),
        metricName,
        duration,
        'error',
      );
      this.metricsService.recordBrightdataError(
        String(datasetId),
        metricName,
        'async_flow',
      );
      this.logger.error(
        `BrightData runDatasetTriggerAndDownload failed (dataset=${String(
          datasetId,
        )}, metric=${metricName})`,
        error,
      );
      this.sentry.sendException(error, {
        datasetId: String(datasetId),
        metricName,
      });
      throw error;
    }
  }

  private async triggerDatasetWithRetries(
    datasetId: BrightdataDataset | string,
    triggerBody: unknown[],
    params: Record<string, string>,
    maxRetries: number,
    signal?: AbortSignal,
  ): Promise<{ snapshot_id: string }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (signal?.aborted) {
          throw new Error('Aborted');
        }
        const response = await this.ensureHttpClient().post<{
          snapshot_id: string;
        }>('/datasets/v3/trigger', triggerBody, {
          params: { dataset_id: datasetId, ...params },
          signal,
        });
        if (!response.data?.snapshot_id) {
          throw new Error('BrightData trigger did not return snapshot_id');
        }
        return response.data;
      } catch (err) {
        lastError = err;
        this.logger.warn(
          `BrightData trigger attempt ${attempt}/${maxRetries} failed`,
          err instanceof Error ? err.message : String(err),
        );
        if (attempt < maxRetries) {
          await this.sleepAbortable(
            BrightdataService.ASYNC_RETRY_DELAY_MS,
            signal,
          );
        }
      }
    }
    throw lastError;
  }

  private async waitForSnapshotWithRetries(
    snapshotId: string,
    opts: {
      timeoutMs: number;
      pollIntervalMs: number;
      maxRetries: number;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    const { timeoutMs, pollIntervalMs, maxRetries, signal } = opts;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      let progress: { status?: string; error?: unknown } | undefined;
      let lastErr: unknown;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (signal?.aborted) {
            throw new Error('Aborted');
          }
          const res = await this.ensureHttpClient().get<{
            status?: string;
            error?: unknown;
          }>(`/datasets/v3/progress/${snapshotId}`, { signal });
          progress = res.data ?? {};
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err;
          this.logger.warn(
            `BrightData progress attempt ${attempt}/${maxRetries} for snapshot ${snapshotId}`,
            err instanceof Error ? err.message : String(err),
          );
          if (attempt < maxRetries) {
            await this.sleepAbortable(
              BrightdataService.ASYNC_RETRY_DELAY_MS,
              signal,
            );
          }
        }
      }

      if (typeof progress === 'undefined') {
        throw lastErr instanceof Error
          ? lastErr
          : new Error('Progress check failed after retries');
      }

      const status = String(progress?.status ?? '').toLowerCase();
      if (status === 'ready') {
        return;
      }
      if (status === 'failed' || status === 'error') {
        throw new Error(
          `BrightData snapshot ${snapshotId} failed: ${JSON.stringify(
            progress,
          )}`,
        );
      }

      await this.sleepAbortable(pollIntervalMs, signal);
    }

    throw new Error(
      `Timed out waiting for BrightData snapshot ${snapshotId} (${timeoutMs}ms)`,
    );
  }

  private async downloadSnapshotWithRetries(
    snapshotId: string,
    maxRetries: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (signal?.aborted) {
          throw new Error('Aborted');
        }
        const response = await this.ensureHttpClient().get<unknown>(
          `/datasets/v3/snapshot/${snapshotId}`,
          {
            params: { format: 'json' },
            responseType: 'text',
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            signal,
          },
        );
        const body = response.data as string;
        try {
          return JSON.parse(body);
        } catch {
          return body;
        }
      } catch (err) {
        lastError = err;
        this.logger.warn(
          `BrightData download snapshot ${snapshotId} attempt ${attempt}/${maxRetries} failed`,
          err instanceof Error ? err.message : String(err),
        );
        if (attempt < maxRetries) {
          await this.sleepAbortable(
            BrightdataService.ASYNC_RETRY_DELAY_MS,
            signal,
          );
        }
      }
    }
    throw lastError;
  }

  private normalizeSnapshotToArray(downloaded: unknown): unknown[] {
    if (Array.isArray(downloaded)) {
      return downloaded;
    }
    if (typeof downloaded === 'string') {
      const lines = downloaded
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const items: unknown[] = [];
      for (const line of lines) {
        try {
          items.push(JSON.parse(line));
        } catch {
          // ignore malformed line
        }
      }
      return items;
    }
    if (downloaded && typeof downloaded === 'object') {
      return [downloaded];
    }
    return [];
  }

  /**
   * Fetches Google SERP (Search Engine Results Page) data from BrightData.
   *
   * @param {GoogleSerpDTO} dto - The search keyword and optional parameters.
   *
   * @returns {Promise<GoogleSerpResponse>} The SERP results from BrightData.
   */
  public async getGoogleSerp(dto: GoogleSerpDTO): Promise<GoogleSerpResponse> {
    const startTime = Date.now();
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

      const response = await this.ensureHttpClient().post<unknown>(
        endpoint,
        requestBody,
        {
          params,
        },
      );

      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordBrightdataCall(
        BrightdataDataset.GOOGLE_SERP,
        'get_google_serp',
        duration,
        'success',
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
      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordBrightdataCall(
        BrightdataDataset.GOOGLE_SERP,
        'get_google_serp',
        duration,
        'error',
      );

      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const status = axiosError.response.status;
        const statusText = axiosError.response.statusText;
        const responseData = axiosError.response.data;

        this.metricsService.recordBrightdataError(
          BrightdataDataset.GOOGLE_SERP,
          'get_google_serp',
          `http_${status}`,
        );

        this.logger.error(
          `BrightData API error for keyword ${dto.keyword}: ${status} - ${statusText}`,
          responseData,
        );

        this.sentry.sendException(error, { keyword: dto.keyword });

        throw new Error(
          `Failed to fetch Google SERP: ${statusText} (${status})`,
        );
      } else if (axiosError.request) {
        this.metricsService.recordBrightdataError(
          BrightdataDataset.GOOGLE_SERP,
          'get_google_serp',
          'no_response',
        );

        this.logger.error(
          `No response from BrightData API for keyword ${dto.keyword}`,
        );

        this.sentry.sendException(error, { keyword: dto.keyword });

        throw new Error('No response from Google SERP API');
      } else {
        this.metricsService.recordBrightdataError(
          BrightdataDataset.GOOGLE_SERP,
          'get_google_serp',
          'request_setup',
        );

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

  /**
   * Fetches Google AI Mode data from BrightData.
   *
   * @param {GoogleAiModeItemDTO} dto - Search item with url, prompt, and optional country.
   *
   * @returns {Promise<GoogleAiModeResponse>} The AI Mode results from BrightData.
   */
  public async getGoogleAiMode(
    dto: GoogleAiModeItemDTO,
  ): Promise<GoogleAiModeResponse> {
    const startTime = Date.now();
    try {
      this.logger.log(`Fetching Google AI Mode data for prompt: ${dto.prompt}`);

      // BrightData Google AI Search API endpoint
      const endpoint = '/datasets/v3/scrape';

      // Request body should be an array (BrightData expects array)
      const requestBody = [
        {
          url: dto.url,
          prompt: dto.prompt,
          country: dto.country || 'US',
        },
      ];

      // Query parameters - using Google AI Search dataset
      const params = {
        dataset_id: BrightdataDataset.GOOGLE_AI_SEARCH,
        include_errors: 'true',
      };

      const response = await this.ensureHttpClient().post<unknown>(
        endpoint,
        requestBody,
        {
          params,
        },
      );

      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordBrightdataCall(
        BrightdataDataset.GOOGLE_AI_SEARCH,
        'get_google_ai_mode',
        duration,
        'success',
      );

      this.logger.log(
        `Successfully fetched AI Mode data for prompt: ${dto.prompt}`,
      );

      return {
        results: response.data,
      };
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordBrightdataCall(
        BrightdataDataset.GOOGLE_AI_SEARCH,
        'get_google_ai_mode',
        duration,
        'error',
      );

      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const status = axiosError.response.status;
        const statusText = axiosError.response.statusText;
        const responseData = axiosError.response.data;

        this.metricsService.recordBrightdataError(
          BrightdataDataset.GOOGLE_AI_SEARCH,
          'get_google_ai_mode',
          `http_${status}`,
        );

        this.logger.error(
          `BrightData API error for AI Mode: ${status} - ${statusText}`,
          responseData,
        );

        this.sentry.sendException(error, { prompt: dto.prompt });

        throw new Error(
          `Failed to fetch Google AI Mode: ${statusText} (${status})`,
        );
      } else if (axiosError.request) {
        this.metricsService.recordBrightdataError(
          BrightdataDataset.GOOGLE_AI_SEARCH,
          'get_google_ai_mode',
          'no_response',
        );

        this.logger.error(`No response from BrightData API for AI Mode`);

        this.sentry.sendException(error, { prompt: dto.prompt });

        throw new Error('No response from Google AI Mode API');
      } else {
        this.metricsService.recordBrightdataError(
          BrightdataDataset.GOOGLE_AI_SEARCH,
          'get_google_ai_mode',
          'request_setup',
        );

        this.logger.error(
          `Error setting up request for AI Mode:`,
          axiosError.message,
        );

        this.sentry.sendException(error, { prompt: dto.prompt });

        throw new Error(
          `Failed to fetch Google AI Mode: ${axiosError.message}`,
        );
      }
    }
  }

  /**
   * Fetches Perplexity search data from BrightData.
   *
   * @param {PerplexitySearchDTO} dto - Search item with url, prompt, and optional index.
   *
   * @returns {Promise<PerplexitySearchResponse>} The Perplexity search results from BrightData.
   */
  public async getPerplexitySearch(
    dto: PerplexitySearchDTO,
  ): Promise<PerplexitySearchResponse> {
    const startTime = Date.now();
    try {
      this.logger.log(
        `Fetching Perplexity search data for prompt: ${dto.prompt}`,
      );

      // BrightData Perplexity API endpoint
      const endpoint = '/datasets/v3/scrape';

      // Request body should be an array (BrightData expects array)
      const requestBody = [
        {
          url: dto.url,
          prompt: dto.prompt,
          index: dto.index || 1,
        },
      ];

      // Query parameters - using Perplexity dataset
      const params = {
        dataset_id: BrightdataDataset.PERPLEXITY,
        include_errors: 'true',
      };

      const response = await this.ensureHttpClient().post<unknown>(
        endpoint,
        requestBody,
        {
          params,
        },
      );

      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordBrightdataCall(
        BrightdataDataset.PERPLEXITY,
        'get_perplexity_search',
        duration,
        'success',
      );

      this.logger.log(
        `Successfully fetched Perplexity search data for prompt: ${dto.prompt}`,
      );

      return {
        results: response.data,
      };
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordBrightdataCall(
        BrightdataDataset.PERPLEXITY,
        'get_perplexity_search',
        duration,
        'error',
      );

      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const status = axiosError.response.status;
        const statusText = axiosError.response.statusText;
        const responseData = axiosError.response.data;

        this.metricsService.recordBrightdataError(
          BrightdataDataset.PERPLEXITY,
          'get_perplexity_search',
          `http_${status}`,
        );

        this.logger.error(
          `BrightData API error for Perplexity search: ${status} - ${statusText}`,
          responseData,
        );

        this.sentry.sendException(error, { prompt: dto.prompt });

        throw new Error(
          `Failed to fetch Perplexity search: ${statusText} (${status})`,
        );
      } else if (axiosError.request) {
        this.metricsService.recordBrightdataError(
          BrightdataDataset.PERPLEXITY,
          'get_perplexity_search',
          'no_response',
        );

        this.logger.error(
          `No response from BrightData API for Perplexity search`,
        );

        this.sentry.sendException(error, { prompt: dto.prompt });

        throw new Error('No response from Perplexity search API');
      } else {
        this.metricsService.recordBrightdataError(
          BrightdataDataset.PERPLEXITY,
          'get_perplexity_search',
          'request_setup',
        );

        this.logger.error(
          `Error setting up request for Perplexity search:`,
          axiosError.message,
        );

        this.sentry.sendException(error, { prompt: dto.prompt });

        throw new Error(
          `Failed to fetch Perplexity search: ${axiosError.message}`,
        );
      }
    }
  }
}
