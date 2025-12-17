import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';

import {
  BrightdataConfigService,
  BrightdataDataset,
  OpenrouterConfigService,
} from '@libs/config';
import { TaskStatus } from '@libs/entities';
import { QueueService } from '@libs/queue';
import {
  TikTokSearchProfilesRepository,
  TasksRepository,
} from '@libs/repositories';
import { SentryClientService } from '@libs/sentry';
import { safeJsonParseFromText } from '@libs/utils';

import { MetricsService } from '../metrics';

interface TikTokSearchContext {
  category: string | null;
  results_count: number | null;
  location: string | null;
  followers_range: string | null;
  country_code: string | null;
  search_terms: string[] | null;
}

export interface TikTokProfileAnalysis {
  profileUrl: string;
  analysis: {
    summary: string;
    score: number;
  };
}

@Injectable()
export class TikTokService {
  private readonly logger = new Logger(TikTokService.name);
  private readonly httpClient: AxiosInstance;

  constructor(
    private readonly brightdataConfig: BrightdataConfigService,
    private readonly openrouterConfig: OpenrouterConfigService,
    private readonly sentry: SentryClientService,
    private readonly queueService: QueueService,
    private readonly tasksRepo: TasksRepository,
    private readonly searchProfilesRepo: TikTokSearchProfilesRepository,
    private readonly metricsService: MetricsService,
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
   * Normalizes a free-form country or location string into an ISO 3166-1 alpha-2 code when possible.
   */
  private normalizeCountryCode(
    value: string | null | undefined,
  ): string | null {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    // Already looks like a 2-letter country code
    if (/^[a-z]{2}$/i.test(trimmed)) {
      return trimmed.toUpperCase();
    }

    const lower = trimmed.toLowerCase();

    const map: Record<string, string> = {
      // Common examples and aliases
      portugal: 'PT',
      'portuguese republic': 'PT',
      'united states': 'US',
      'united states of america': 'US',
      usa: 'US',
      us: 'US',
      america: 'US',
      'united kingdom': 'GB',
      uk: 'GB',
      england: 'GB',
      scotland: 'GB',
      wales: 'GB',
      'northern ireland': 'GB',
      germany: 'DE',
      deutschland: 'DE',
      france: 'FR',
      spain: 'ES',
      espana: 'ES',
      españa: 'ES',
      italy: 'IT',
      italia: 'IT',
      canada: 'CA',
      australia: 'AU',
      brazil: 'BR',
      brasil: 'BR',
      mexico: 'MX',
      japan: 'JP',
      nippon: 'JP',
      china: 'CN',
      india: 'IN',
    };

    return map[lower] ?? null;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async triggerDataset(
    datasetId: BrightdataDataset,
    triggerBody: unknown[],
    params: Record<string, string>,
  ): Promise<{ snapshot_id: string }> {
    const response = await this.httpClient.post<{ snapshot_id: string }>(
      '/datasets/v3/trigger',
      triggerBody,
      {
        params: {
          dataset_id: datasetId,
          ...params,
        },
      },
    );

    if (!response.data?.snapshot_id) {
      throw new Error('BrightData trigger did not return snapshot_id');
    }

    return response.data;
  }

  private async waitForSnapshot(
    snapshotId: string,
    opts?: { timeoutMs?: number; pollIntervalMs?: number },
  ): Promise<'ready'> {
    const timeoutMs = opts?.timeoutMs ?? 5 * 60 * 1000; // 5 minutes
    const pollIntervalMs = opts?.pollIntervalMs ?? 3000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const progress = await this.httpClient.get<{
        status?: string;
        error?: unknown;
      }>(`/datasets/v3/progress/${snapshotId}`);

      const status = String(progress.data?.status || '').toLowerCase();

      if (status === 'ready') {
        return 'ready';
      }

      if (status === 'failed' || status === 'error') {
        throw new Error(
          `BrightData snapshot ${snapshotId} failed: ${JSON.stringify(
            progress.data,
          )}`,
        );
      }

      await this.sleep(pollIntervalMs);
    }

    throw new Error(`Timed out waiting for BrightData snapshot ${snapshotId}`);
  }

  private async downloadSnapshot(
    snapshotId: string,
    format: 'json' | 'ndjson' = 'json',
  ): Promise<unknown> {
    const response = await this.httpClient.get(
      `/datasets/v3/snapshot/${snapshotId}`,
      {
        params: { format },
        // allow large responses
        responseType: 'text',
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      },
    );

    const body = response.data as string;

    if (format === 'ndjson') {
      const lines = body
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

    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  private async runDatasetAndDownload(
    datasetId: BrightdataDataset,
    triggerBody: unknown[],
    params: Record<string, string>,
    metricName: string,
  ): Promise<unknown[]> {
    const startTime = Date.now();
    try {
      const { snapshot_id } = await this.triggerDataset(
        datasetId,
        triggerBody,
        {
          include_errors: 'true',
          ...params,
        },
      );

      await this.waitForSnapshot(snapshot_id, {
        timeoutMs: 25 * 60 * 1000,
        pollIntervalMs: 4000,
      });

      const downloaded = await this.downloadSnapshot(snapshot_id, 'json');

      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordBrightdataCall(datasetId, metricName, duration);

      if (Array.isArray(downloaded)) {
        return downloaded as unknown[];
      }

      if (downloaded && typeof downloaded === 'object') {
        return [downloaded] as unknown[];
      }

      return [];
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordBrightdataCall(
        datasetId,
        metricName,
        duration,
        'error',
      );
      throw error;
    }
  }

  /**
   * Extracts structured context from a free-form user query about finding TikTok creators.
   *
   * @param {string} query - The raw user query.
   *
   * @returns {Promise<TikTokSearchContext>} Parsed context object.
   */
  public async extractSearchContext(
    query: string,
  ): Promise<TikTokSearchContext> {
    try {
      const client = new ChatOpenAI({
        modelName: 'anthropic/claude-3.5-sonnet',
        openAIApiKey: this.openrouterConfig.apiKey,
        configuration: {
          baseURL: this.openrouterConfig.baseUrl,
          defaultHeaders: {
            'HTTP-Referer': 'https://wykra-api.com',
            'X-Title': 'Wykra API - TikTok Search',
          },
        },
        temperature: 0,
        timeout: this.openrouterConfig.timeout,
      });

      const prompt = `Extract structured context from the user query about finding TikTok creators.

From the query, identify and return the following fields (leave empty if not provided):

category: the niche or topic the user wants (e.g., cooking, beauty, travel).

results_count: the number of creators requested, if mentioned.

location: the geographic area (city, region, country) if mentioned (free-form, e.g. "Portugal" or "Lisbon, Portugal").

followers_range: the desired follower count or range, if included.

country_code: the 2-letter ISO 3166-1 alpha-2 country code for the main country inferred from the query (e.g., "PT" for Portugal, "US" for United States). If you are not sure, leave it empty.

search_terms: an array of 2-3 short search phrases (strings) that should be used in TikTok's search box to find relevant creators for this query. Each item should be a concise query like "baking Portugal" or "sourdough bread Lisbon". Order them from most to least relevant.

Return the result strictly as a JSON object with these fields (keys: category, results_count, location, followers_range, country_code, search_terms).

User query: '${query}'`;

      const llmStartTime = Date.now();
      const response = await client.invoke([new HumanMessage(prompt)]);
      const llmDuration = (Date.now() - llmStartTime) / 1000;
      const responseText = response.content as string;

      const model = 'anthropic/claude-3.5-sonnet';
      this.metricsService.recordLLMCall(model, 'tiktok_search_context');
      this.metricsService.recordLLMCallDuration(
        model,
        'tiktok_search_context',
        llmDuration,
        'success',
      );

      const parsed =
        safeJsonParseFromText<Partial<TikTokSearchContext>>(
          responseText,
          'object',
        ) ?? {};

      const rawLocation =
        typeof parsed.location === 'string' ? parsed.location : null;
      const rawCountryCode =
        typeof parsed.country_code === 'string' ? parsed.country_code : null;
      const countryCode = this.normalizeCountryCode(
        rawCountryCode || rawLocation,
      );

      const rawSearchTerms = Array.isArray(parsed.search_terms)
        ? parsed.search_terms
        : [];
      const searchTerms = rawSearchTerms
        .filter((v) => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
        .slice(0, 3);

      return {
        category: typeof parsed.category === 'string' ? parsed.category : null,
        results_count:
          typeof parsed.results_count === 'number'
            ? parsed.results_count
            : parsed.results_count &&
                !Number.isNaN(Number(parsed.results_count))
              ? Number(parsed.results_count)
              : null,
        location: rawLocation,
        followers_range:
          typeof parsed.followers_range === 'string'
            ? parsed.followers_range
            : null,
        country_code: countryCode,
        search_terms: searchTerms.length ? searchTerms : null,
      };
    } catch (error) {
      this.metricsService.recordLLMError(
        'anthropic/claude-3.5-sonnet',
        'tiktok_search_context',
        'api_error',
      );

      this.logger.error(
        'Error extracting TikTok search context with OpenRouter:',
        error,
      );
      this.sentry.sendException(error, { query });

      return {
        category: null,
        results_count: null,
        location: null,
        followers_range: null,
        country_code: null,
        search_terms: null,
      };
    }
  }

  /**
   * Collects TikTok profile data from BrightData by profile URLs.
   *
   * @param {string[]} urls - Array of TikTok profile URLs to collect.
   *
   * @returns {Promise<unknown[]>} Array of raw profile objects from BrightData.
   */
  public async collectProfilesByUrls(urls: string[]): Promise<unknown[]> {
    if (!urls.length) {
      return [];
    }
    try {
      this.logger.log(
        `Collecting TikTok profiles by URL from BrightData for ${urls.length} urls`,
      );
      const triggerBody = urls.map((url) => ({ url }));
      const profiles = await this.runDatasetAndDownload(
        BrightdataDataset.TIKTOK,
        triggerBody,
        {
          notify: 'false',
          type: 'url_collection',
        },
        'collect_profiles_by_urls',
      );

      return profiles;
    } catch (error) {
      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const status = axiosError.response.status;
        const statusText = axiosError.response.statusText;
        const responseData = axiosError.response.data;

        this.logger.error(
          `BrightData API error for TikTok collectProfilesByUrls: ${status} - ${statusText}`,
          responseData,
        );

        this.sentry.sendException(error, { urls });

        throw new Error(
          `Failed to collect TikTok profiles by URL: ${statusText} (${status})`,
        );
      } else if (axiosError.request) {
        this.logger.error(
          'No response from BrightData API for TikTok collectProfilesByUrls',
        );

        this.sentry.sendException(error, { urls });

        throw new Error('No response from TikTok collect-by-URL API');
      } else {
        this.logger.error(
          'Error setting up request for TikTok collectProfilesByUrls:',
          axiosError.message,
        );

        this.sentry.sendException(error, { urls });

        throw new Error(
          `Failed to collect TikTok profiles by URL: ${axiosError.message}`,
        );
      }
    }
  }

  /**
   * Discovers TikTok creator profiles by TikTok search URL using BrightData dataset mode:
   * type=discover_new&discover_by=search_url
   *
   * @param {string} searchUrl - TikTok search URL, e.g. https://www.tiktok.com/search?q=...
   * @param {string} country - Country code for discovery, defaults to 'US'
   */
  public async discoverProfilesBySearchUrl(
    searchUrl: string,
    country = 'US',
  ): Promise<unknown[]> {
    try {
      const triggerBody = [
        {
          search_url: searchUrl,
          country,
        },
      ];

      return await this.runDatasetAndDownload(
        BrightdataDataset.TIKTOK,
        triggerBody,
        {
          notify: 'false',
          type: 'discover_new',
          discover_by: 'search_url',
        },
        'discover_by_search_url',
      );
    } catch (error) {
      this.logger.error(
        'Error discovering TikTok profiles by search URL',
        error,
      );
      this.sentry.sendException(error, { searchUrl, country });
      throw error;
    }
  }

  /**
   * Runs a short Anthropic analysis for each collected TikTok profile and persists it.
   */
  public async analyzeCollectedProfiles(
    taskId: string,
    profiles: unknown[],
    query: string,
  ): Promise<TikTokProfileAnalysis[]> {
    if (!profiles.length) {
      return [];
    }

    const client = new ChatOpenAI({
      modelName: 'anthropic/claude-3.5-sonnet',
      openAIApiKey: this.openrouterConfig.apiKey,
      configuration: {
        baseURL: this.openrouterConfig.baseUrl,
        defaultHeaders: {
          'HTTP-Referer': 'https://wykra-api.com',
          'X-Title': 'Wykra API - TikTok Profile Analysis',
        },
      },
      temperature: 0,
      timeout: this.openrouterConfig.timeout,
    });

    const analyses: TikTokProfileAnalysis[] = [];

    for (const profile of profiles) {
      const p = profile as Record<string, unknown>;

      const profileUrl =
        (typeof p.profile_url === 'string' && p.profile_url) ||
        (typeof p.url === 'string' && p.url) ||
        (typeof p.profileUrl === 'string' && p.profileUrl) ||
        null;

      if (!profileUrl) {
        continue;
      }

      const account =
        (typeof p.account_id === 'string' && p.account_id) ||
        (typeof p.unique_id === 'string' && p.unique_id) ||
        (typeof p.username === 'string' && p.username) ||
        (typeof p.handle === 'string' && p.handle) ||
        (typeof p.user_name === 'string' && p.user_name) ||
        (typeof p.nickname === 'string' && p.nickname) ||
        (typeof p.account === 'string' && p.account) ||
        'unknown';

      const followers =
        (typeof p.followers === 'number' && p.followers) ||
        (typeof p.followers_count === 'number' && p.followers_count) ||
        (typeof p.follower_count === 'number' && p.follower_count) ||
        null;

      const isPrivate =
        (typeof p.is_private === 'boolean' && p.is_private) ||
        (typeof p.private_account === 'boolean' && p.private_account) ||
        null;

      const biography =
        (typeof p.biography === 'string' && p.biography) ||
        (typeof p.bio === 'string' && p.bio) ||
        (typeof p.signature === 'string' && p.signature) ||
        null;

      const prompt = `You are analyzing a TikTok creator profile for brand/influencer discovery.

Original user query (what the brand is looking for):
${query}

Profile data (JSON):
${JSON.stringify(
  {
    account,
    profile_url: profileUrl,
    followers,
    is_private: isPrivate,
    biography,
  },
  null,
  2,
)}

Provide a very short evaluation of this profile's potential as a micro-influencer for brand collaborations.

Return ONLY a JSON object with the following shape:
{
  "summary": "1–3 sentence summary explaining the profile and why it is or is not a good fit.",
  "score": 1-5,
  "relevance": 0-100
}`;

      try {
        const response = await client.invoke([new HumanMessage(prompt)]);
        const responseText = response.content as string;

        const parsed =
          safeJsonParseFromText<{
            summary?: string;
            score?: number;
            relevance?: number;
            relevance_percent?: number;
          }>(responseText, 'object') ?? {};

        const summary =
          typeof parsed.summary === 'string' && parsed.summary.length > 0
            ? parsed.summary
            : `Basic analysis for ${account} (${profileUrl}). Followers: ${
                followers ?? 'unknown'
              }.`;

        let score =
          typeof parsed.score === 'number' && !Number.isNaN(parsed.score)
            ? parsed.score
            : 3;

        if (score < 1 || score > 5) {
          score = 3;
        }

        // Determine how relevant this profile is to the original query
        let relevance =
          typeof parsed.relevance === 'number'
            ? parsed.relevance
            : typeof parsed.relevance_percent === 'number'
              ? parsed.relevance_percent
              : 100;

        if (!Number.isFinite(relevance)) {
          relevance = 100;
        }

        // Clamp to [0, 100]
        if (relevance < 0) {
          relevance = 0;
        } else if (relevance > 100) {
          relevance = 100;
        }

        // Skip profiles that are less than 70% relevant to the query
        if (relevance < 70) {
          continue;
        }

        analyses.push({
          profileUrl,
          analysis: { summary, score },
        });

        // Persist this profile immediately after analysis
        try {
          await this.searchProfilesRepo.createMany([
            {
              taskId,
              account,
              profileUrl,
              followers,
              isPrivate,
              analysisSummary: summary,
              analysisScore: score,
              raw: JSON.stringify(p),
            },
          ]);
        } catch (saveError) {
          this.logger.error(
            `Failed to save TikTokSearchProfile for ${profileUrl}`,
            saveError,
          );
          this.sentry.sendException(saveError, { profileUrl, taskId });
        }
      } catch (error) {
        this.logger.error(
          `Error analyzing TikTok profile: ${profileUrl}`,
          error,
        );
        this.sentry.sendException(error, { profileUrl });

        analyses.push({
          profileUrl,
          analysis: {
            summary: `Analysis failed for ${account} (${profileUrl}).`,
            score: 2,
          },
        });
      }
    }

    return analyses;
  }

  /**
   * Creates a new TikTok search job and queues it for processing.
   *
   * @param {string} query - The search query string.
   *
   * @returns {Promise<string>} The task ID.
   */
  public async search(query: string): Promise<string> {
    const taskId = randomUUID();

    await this.tasksRepo.create({
      taskId,
      status: TaskStatus.Pending,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
    });

    await this.queueService.tiktok.add('search', {
      taskId,
      query,
    });

    this.metricsService.recordTaskCreated('tiktok_search');

    return taskId;
  }
}
