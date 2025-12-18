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
import {
  TikTokAnalysisData,
  TikTokAnalysisResult,
  TikTokProfile,
} from './interfaces';

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
  private readonly llmClient: ChatOpenAI;

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

    // Initialize OpenRouter LLM client (OpenRouter uses OpenAI-compatible API)
    this.llmClient = new ChatOpenAI({
      modelName: this.openrouterConfig.model,
      openAIApiKey: this.openrouterConfig.apiKey,
      configuration: {
        baseURL: this.openrouterConfig.baseUrl,
        defaultHeaders: {
          'HTTP-Referer': 'https://wykra-api.com',
          'X-Title': 'Wykra API',
        },
      },
      temperature: 0,
      timeout: this.openrouterConfig.timeout,
    });
  }

  private normalizeTikTokProfileUrl(profileOrUrl: string): string {
    const trimmed = (profileOrUrl || '').trim();
    if (!trimmed) {
      return 'https://www.tiktok.com/@';
    }

    // If it already has a scheme, assume it's a URL
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    // If user pasted a URL without scheme
    if (/^www\./i.test(trimmed) || /tiktok\.com/i.test(trimmed)) {
      return `https://${trimmed.replace(/^\/+/, '')}`;
    }

    // Otherwise treat as handle
    let handle = trimmed;
    if (handle.startsWith('@')) {
      handle = handle.slice(1);
    }
    handle = handle.replace(/^tiktok\.com\/@/i, '');
    return `https://www.tiktok.com/@${handle}`;
  }

  private extractHashtags(text: string): string[] {
    if (!text) {
      return [];
    }
    const hashtagRegex = /#[\w]+/g;
    const matches = text.match(hashtagRegex);
    return matches ? matches.map((tag) => tag.substring(1)) : [];
  }

  /**
   * Scrapes and analyzes a TikTok profile by fetching data from BrightData
   * and processing the results using OpenRouter LLM.
   */
  public async analyzeProfile(profile: string): Promise<TikTokAnalysisData> {
    try {
      this.logger.log(`Starting analysis for TikTok profile: ${profile}`);

      const profileData = await this.fetchProfileData(profile);
      const analysis = await this.processWithLLM(profileData);

      return {
        profile,
        data: profileData,
        analysis,
      };
    } catch (error) {
      this.logger.error(`Error analyzing TikTok profile ${profile}:`, error);
      this.sentry.sendException(error, { profile });
      throw error;
    }
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

  /**
   * Fetches profile data from BrightData for a TikTok profile (username or URL).
   */
  private async fetchProfileData(profile: string): Promise<TikTokProfile> {
    const url = this.normalizeTikTokProfileUrl(profile);

    try {
      this.logger.log(`Fetching TikTok profile data for: ${profile} (${url})`);

      const items = await this.runDatasetAndDownload(
        BrightdataDataset.TIKTOK,
        [{ url }],
        {
          notify: 'false',
          type: 'url_collection',
        },
        'fetch_profile_data',
      );

      if (items.length > 0 && items[0] && typeof items[0] === 'object') {
        return items[0] as TikTokProfile;
      }

      throw new Error(
        'Unexpected response format from BrightData API. Expected array with profile data.',
      );
    } catch (error) {
      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const status = axiosError.response.status;
        const statusText = axiosError.response.statusText;
        const responseData = axiosError.response.data;

        this.logger.error(
          `BrightData API error for TikTok profile ${profile}: ${status} - ${statusText}`,
          responseData,
        );
        throw new Error(
          `Failed to fetch TikTok profile: ${statusText} (${status})`,
        );
      }

      if (axiosError.request) {
        this.logger.error(
          `No response from BrightData API for TikTok profile ${profile}`,
        );
        throw new Error('No response from TikTok scraper API');
      }

      this.logger.error(
        `Error setting up request for TikTok profile ${profile}:`,
        axiosError.message,
      );
      throw new Error(`Failed to fetch TikTok profile: ${axiosError.message}`);
    }
  }

  /**
   * Processes TikTok profile data using OpenRouter LLM API.
   */
  private async processWithLLM(
    profileData: TikTokProfile,
  ): Promise<TikTokAnalysisResult> {
    try {
      this.logger.log('Processing TikTok profile data with OpenRouter LLM');

      const p = profileData as Record<string, unknown>;

      const isPrivate =
        (typeof p.is_private === 'boolean' && p.is_private) ||
        (typeof p.private_account === 'boolean' && p.private_account) ||
        (typeof p.isPrivate === 'boolean' && p.isPrivate) ||
        false;

      if (isPrivate) {
        return {
          summary: 'Profile is private. Cannot analyze private profiles.',
          qualityScore: 0,
          message: 'Profile is private and cannot be analyzed.',
        };
      }

      const account =
        (typeof p.unique_id === 'string' && p.unique_id) ||
        (typeof p.username === 'string' && p.username) ||
        (typeof p.handle === 'string' && p.handle) ||
        (typeof p.user_name === 'string' && p.user_name) ||
        (typeof p.account_id === 'string' && p.account_id) ||
        (typeof p.account === 'string' && p.account) ||
        null;

      const followers =
        (typeof p.followers === 'number' && p.followers) ||
        (typeof p.followers_count === 'number' && p.followers_count) ||
        (typeof p.follower_count === 'number' && p.follower_count) ||
        null;

      const following =
        (typeof p.following === 'number' && p.following) ||
        (typeof p.following_count === 'number' && p.following_count) ||
        null;

      const likes =
        (typeof p.likes === 'number' && p.likes) ||
        (typeof p.likes_count === 'number' && p.likes_count) ||
        (typeof p.heart_count === 'number' && p.heart_count) ||
        null;

      const videosCount =
        (typeof p.videos_count === 'number' && p.videos_count) ||
        (typeof p.video_count === 'number' && p.video_count) ||
        (typeof p.posts_count === 'number' && p.posts_count) ||
        null;

      const biography =
        (typeof p.biography === 'string' && p.biography) ||
        (typeof p.bio === 'string' && p.bio) ||
        (typeof p.signature === 'string' && p.signature) ||
        null;

      const profileUrl =
        (typeof p.profile_url === 'string' && p.profile_url) ||
        (typeof p.url === 'string' && p.url) ||
        (account
          ? `https://www.tiktok.com/@${account.replace(/^@/, '')}`
          : null);

      const rawVideos =
        (Array.isArray(p.videos) && p.videos) ||
        (Array.isArray(p.posts) && p.posts) ||
        (Array.isArray(p.recent_videos) && p.recent_videos) ||
        (Array.isArray(p.items) && p.items) ||
        [];

      const videos = (rawVideos as unknown[]).slice(0, 10).map((v) => {
        const vv = (v || {}) as Record<string, unknown>;
        const caption =
          (typeof vv.caption === 'string' && vv.caption) ||
          (typeof vv.description === 'string' && vv.description) ||
          (typeof vv.desc === 'string' && vv.desc) ||
          '';
        const views =
          (typeof vv.views === 'number' && vv.views) ||
          (typeof vv.play_count === 'number' && vv.play_count) ||
          (typeof vv.view_count === 'number' && vv.view_count) ||
          null;
        const likesV =
          (typeof vv.likes === 'number' && vv.likes) ||
          (typeof vv.digg_count === 'number' && vv.digg_count) ||
          (typeof vv.like_count === 'number' && vv.like_count) ||
          null;
        const commentsV =
          (typeof vv.comments === 'number' && vv.comments) ||
          (typeof vv.comment_count === 'number' && vv.comment_count) ||
          null;
        const sharesV =
          (typeof vv.shares === 'number' && vv.shares) ||
          (typeof vv.share_count === 'number' && vv.share_count) ||
          null;
        return {
          caption: caption ? caption.substring(0, 220) : null,
          views,
          likes: likesV,
          comments: commentsV,
          shares: sharesV,
          hashtags: this.extractHashtags(caption),
        };
      });

      if (!account || !followers) {
        return {
          summary:
            'Insufficient data available for analysis. Profile may be new, restricted, or dataset returned limited fields.',
          qualityScore: 0,
          message: 'Data is not suitable for evaluation.',
        };
      }

      const prompt = `Analyze this TikTok creator profile data and provide a detailed analysis.

Profile Data:
- Account: ${account}
- Profile URL: ${profileUrl || 'Unknown'}
- Followers: ${(followers || 0).toLocaleString()}
- Following: ${(following || 0).toLocaleString()}
- Total Likes: ${(likes || 0).toLocaleString()}
- Videos Count: ${(videosCount || 0).toLocaleString()}
- Bio: ${biography || 'No bio'}

Recent Videos Sample:
${videos
  .map(
    (post, idx) => `
Video ${idx + 1}:
- Caption: ${post.caption || 'No caption'}
- Views: ${post.views ?? 'unknown'}
- Likes: ${post.likes ?? 'unknown'}
- Comments: ${post.comments ?? 'unknown'}
- Shares: ${post.shares ?? 'unknown'}
- Hashtags: ${post.hashtags?.join(', ') || 'None'}`,
  )
  .join('\n')}

Please analyze this profile and provide a comprehensive analysis covering:

1. **Core Themes/Topics**: What are the main themes of the creator's content and positioning?
2. **Sponsored Content (Frequency & Fit)**: How often do they appear to do sponsorships and does it feel on-brand?
3. **Content Authenticity**: Does the content feel authentic versus overly artificial?
4. **Follower Authenticity**: Are their followers likely real? Any red flags like low engagement vs audience size?
5. **Visible Brands & Commercial Activity**: Which brands are visible or likely partners?
6. **Engagement Strength & Patterns**: Strength of engagement and what content styles drive it (hooks, series, etc.).
7. **Format Performance**: Performance patterns for different formats (e.g. talking head, UGC, tutorials, trends).
8. **Posting Consistency & Aesthetic**: Consistency and recognizable format/series.
9. **Content Quality**: Storytelling, framing, editing style, overall quality.
10. **Hashtags & SEO**: Hashtag usage and keywords relevance to niche.

Return your analysis as a JSON object with the following structure:
{
  "summary": "A comprehensive 2-3 paragraph summary of the profile analysis",
  "qualityScore": <number from 1 to 5>,
  "topic": "<main topic/niche>",
  "niche": "<specific niche if applicable>",
  "sponsoredFrequency": "<low/medium/high>",
  "contentAuthenticity": "<authentic/artificial/mixed>",
  "followerAuthenticity": "<likely real/likely fake/mixed>",
  "visibleBrands": ["<brand1>", "<brand2>", ...],
  "engagementStrength": "<weak/moderate/strong>",
  "postsAnalysis": "<detailed analysis of content formats and engagement patterns>",
  "hashtagsStatistics": "<analysis of hashtag/keyword usage>"
}

Quality Score Guidelines:
- 1: Very poor quality, likely fake, low engagement, spam-like content
- 2: Poor quality, suspicious activity, low authenticity
- 3: Average quality, some concerns but generally acceptable
- 4: Good quality, authentic content, strong engagement
- 5: Excellent quality, highly authentic, strong engagement, established presence

Return ONLY the JSON object, no additional text or markdown formatting.`;

      const llmStartTime = Date.now();
      const response = await this.llmClient.invoke([new HumanMessage(prompt)]);
      const llmDuration = (Date.now() - llmStartTime) / 1000;

      const model = this.openrouterConfig.model || 'unknown';
      this.metricsService.recordLLMCall(model, 'tiktok_profile_analysis');
      this.metricsService.recordLLMCallDuration(
        model,
        'tiktok_profile_analysis',
        llmDuration,
        'success',
      );

      // Extract usage from multiple possible locations
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;

      if (response.response_metadata?.tokenUsage) {
        const tokenUsage = response.response_metadata.tokenUsage;
        promptTokens = Number(tokenUsage.promptTokens) || 0;
        completionTokens = Number(tokenUsage.completionTokens) || 0;
        totalTokens = Number(tokenUsage.totalTokens) || 0;
      } else if (response.usage_metadata) {
        promptTokens = Number(response.usage_metadata.input_tokens) || 0;
        completionTokens = Number(response.usage_metadata.output_tokens) || 0;
        totalTokens = Number(response.usage_metadata.total_tokens) || 0;
      } else if (response.response_metadata?.usage) {
        const usage = response.response_metadata.usage as Record<
          string,
          unknown
        >;
        promptTokens = Number(usage.prompt_tokens) || 0;
        completionTokens = Number(usage.completion_tokens) || 0;
        totalTokens = Number(usage.total_tokens) || 0;
      }

      this.metricsService.recordLLMTokenUsage(
        model,
        'tiktok_profile_analysis',
        promptTokens,
        completionTokens,
        totalTokens,
      );
      this.metricsService.recordLLMTokensPerRequest(
        'tiktok',
        promptTokens,
        completionTokens,
      );

      const responseText = response.content as string;
      let analysis: TikTokAnalysisResult;

      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]) as TikTokAnalysisResult;
        } else {
          analysis = JSON.parse(responseText) as TikTokAnalysisResult;
        }

        if (
          analysis.qualityScore &&
          (analysis.qualityScore < 1 || analysis.qualityScore > 5)
        ) {
          this.logger.warn(
            `Invalid quality score ${analysis.qualityScore}, defaulting to 3`,
          );
          analysis.qualityScore = 3;
        }

        if (!analysis.summary) {
          analysis.summary = 'Analysis completed but summary not provided.';
        }
        if (!analysis.qualityScore) {
          analysis.qualityScore = 3;
        }
      } catch (parseError) {
        this.logger.warn(
          'Failed to parse LLM response as JSON, using fallback analysis',
          parseError,
        );

        analysis = {
          summary: `Profile analysis for ${account}. ${followers.toLocaleString()} followers.`,
          qualityScore: 3,
          topic: 'Unable to determine from available data',
          engagementStrength: 'moderate',
          message: 'LLM response parsing failed, using basic analysis.',
        };
      }

      return analysis;
    } catch (error) {
      const model = this.openrouterConfig.model || 'unknown';
      this.metricsService.recordLLMError(
        model,
        'tiktok_profile_analysis',
        'api_error',
      );

      this.logger.error('Error processing TikTok profile with LLM:', error);
      this.sentry.sendException(error);

      return {
        summary:
          'LLM analysis failed; returning fallback analysis. Profile data was scraped successfully.',
        qualityScore: 2,
        message: 'LLM analysis failed, using fallback analysis.',
      };
    }
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

  /**
   * Creates a new TikTok profile analysis job and queues it for processing.
   *
   * @param {string} profile - TikTok handle or URL
   *
   * @returns {Promise<string>} The task ID.
   */
  public async profile(profile: string): Promise<string> {
    const taskId = randomUUID();

    await this.tasksRepo.create({
      taskId,
      status: TaskStatus.Pending,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
    });

    await this.queueService.tiktok.add('profile', {
      taskId,
      profile,
    });

    this.metricsService.recordTaskCreated('tiktok_profile');

    return taskId;
  }
}
