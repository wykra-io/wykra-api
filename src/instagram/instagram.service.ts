import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { randomUUID } from 'crypto';

import {
  BrightdataConfigService,
  BrightdataDataset,
  OpenrouterConfigService,
} from '@libs/config';
import { TaskStatus } from '@libs/entities';
import { QueueService } from '@libs/queue';
import { SentryClientService } from '@libs/sentry';
import { safeJsonParseFromText } from '@libs/utils';
import {
  InstagramSearchProfilesRepository,
  TasksRepository,
} from '@libs/repositories';
import { MetricsService } from '../metrics';

import {
  InstagramAnalysisData,
  InstagramAnalysisResult,
  InstagramProfile,
} from './interfaces';

interface InstagramSearchContext {
  category: string | null;
  results_count: number | null;
  location: string | null;
  followers_range: string | null;
}

export interface InstagramProfileAnalysis {
  profileUrl: string;
  analysis: {
    summary: string;
    score: number;
  };
}

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  private readonly httpClient: AxiosInstance | null;
  private readonly llmClient: ChatOpenAI;

  constructor(
    private readonly brightdataConfig: BrightdataConfigService,
    private readonly openrouterConfig: OpenrouterConfigService,
    private readonly sentry: SentryClientService,
    private readonly queueService: QueueService,
    private readonly tasksRepo: TasksRepository,
    private readonly searchProfilesRepo: InstagramSearchProfilesRepository,
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
        'BrightData API key not configured. Instagram BrightData features will be unavailable.',
      );
    }

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

  private ensureHttpClient(): AxiosInstance {
    if (!this.httpClient) {
      throw new Error(
        'BrightData API key is not configured. Please set BRIGHTDATA_API_KEY environment variable.',
      );
    }
    return this.httpClient;
  }

  /**
   * Analyzes an Instagram profile by fetching data from a third-party API
   * and processing the results using LLM.
   *
   * @param {string} profile - The Instagram profile username to analyze.
   *
   * @returns {Promise<InstagramAnalysisData>} The processed analysis results.
   */
  public async analyzeProfile(profile: string): Promise<InstagramAnalysisData> {
    try {
      this.logger.log(`Starting analysis for Instagram profile: ${profile}`);

      const profileData = await this.fetchProfileData(profile);
      const analysis = await this.processWithLLM(profileData);

      return {
        profile,
        data: profileData,
        analysis,
      };
    } catch (error) {
      this.logger.error(`Error analyzing profile ${profile}:`, error);
      this.sentry.sendException(error, { profile });

      throw error;
    }
  }

  /**
   * Creates a new Instagram suspicious comments analysis job and queues it for processing.
   */
  public async commentsSuspicious(profile: string): Promise<string> {
    const taskId = randomUUID();

    await this.tasksRepo.create({
      taskId,
      status: TaskStatus.Pending,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
    });

    await this.queueService.instagram.add('comments_suspicious', {
      taskId,
      profile,
    });

    this.metricsService.recordTaskCreated('instagram_comments_suspicious');

    return taskId;
  }

  /**
   * Analyzes suspicious comments for an Instagram profile by scraping comments from recent posts.
   *
   * Flow mirrors TikTok:
   * - fetch profile to get post URLs
   * - scrape comments (BrightData dataset id provided via config)
   * - run LLM suspicious-activity analysis
   */
  public async analyzeSuspiciousComments(profile: string): Promise<unknown> {
    try {
      this.logger.log(
        `Starting suspicious comments analysis for Instagram profile: ${profile}`,
      );

      const profileData = await this.fetchProfileData(profile);
      const p = profileData as unknown as Record<string, unknown>;

      // Extract post URLs from the profile (use the canonical interface field first, but be defensive)
      const rawPosts =
        (Array.isArray((p as { posts?: unknown[] }).posts) &&
          (p as { posts?: unknown[] }).posts) ||
        (Array.isArray((p as { items?: unknown[] }).items) &&
          (p as { items?: unknown[] }).items) ||
        [];

      const postUrls: string[] = [];
      const seenUrls = new Set<string>();

      for (const post of rawPosts.slice(0, 5)) {
        const postObj = (post || {}) as Record<string, unknown>;
        const postUrl =
          (typeof postObj.url === 'string' && postObj.url) ||
          (typeof postObj.post_url === 'string' && postObj.post_url) ||
          (typeof postObj.permalink === 'string' && postObj.permalink) ||
          null;

        if (
          postUrl &&
          postUrl.includes('instagram.com') &&
          !seenUrls.has(postUrl)
        ) {
          postUrls.push(postUrl);
          seenUrls.add(postUrl);
        }
      }

      if (postUrls.length === 0) {
        this.logger.warn(
          `No post URLs found for profile ${profile} to scrape comments`,
        );
        return {
          profile,
          postsAnalyzed: 0,
          message: 'No posts found to analyze comments',
        };
      }

      const startTime = Date.now();
      const endpoint = `/datasets/v3/scrape`;
      const requestBody = postUrls.map((url) => ({ url }));
      const params = {
        dataset_id: BrightdataDataset.INSTAGRAM_POST_COMMENTS,
        notify: 'false',
        include_errors: 'true',
        limit_per_input: '50',
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
        BrightdataDataset.INSTAGRAM_POST_COMMENTS,
        'scrape_post_comments',
        duration,
      );

      const data = response.data;
      const allComments: unknown[] = Array.isArray(data)
        ? (data as unknown[])
        : data && typeof data === 'object'
          ? [data]
          : typeof data === 'string'
            ? data
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .map((line) => {
                  try {
                    return JSON.parse(line) as unknown;
                  } catch {
                    return null;
                  }
                })
                .filter((x): x is unknown => x !== null)
            : [];

      let suspiciousAnalysis: unknown = null;
      if (allComments.length > 0) {
        try {
          this.logger.log(
            `Analyzing ${allComments.length} comments for suspicious activity with LLM`,
          );
          suspiciousAnalysis = await this.analyzeCommentsForSuspiciousActivity(
            allComments,
            profile,
          );
        } catch (error) {
          this.logger.error(
            'Error analyzing comments with LLM, returning raw comments:',
            error,
          );
          this.sentry.sendException(error, {
            profile,
            commentCount: allComments.length,
          });
        }
      }

      return {
        profile,
        postsAnalyzed: postUrls.length,
        totalComments: allComments.length,
        postUrls,
        analysis: suspiciousAnalysis,
      };
    } catch (error) {
      this.logger.error(
        `Error analyzing suspicious comments for Instagram profile ${profile}:`,
        error,
      );
      this.sentry.sendException(error, { profile });
      throw error;
    }
  }

  private async analyzeCommentsForSuspiciousActivity(
    comments: unknown[],
    profile: string,
  ): Promise<unknown> {
    try {
      const commentData = comments.slice(0, 150).map((comment, idx) => {
        const c = (comment || {}) as Record<string, unknown>;
        return {
          index: idx + 1,
          comment_text:
            (typeof c.comment === 'string' && c.comment) ||
            (typeof c.comment_text === 'string' && c.comment_text) ||
            (typeof c.text === 'string' && c.text) ||
            '',
          commenter_user_name:
            (typeof c.comment_user === 'string' && c.comment_user) ||
            (typeof c.commenter_user_name === 'string' &&
              c.commenter_user_name) ||
            (typeof c.username === 'string' && c.username) ||
            (typeof c.user_name === 'string' && c.user_name) ||
            'unknown',
          num_likes:
            (typeof c.likes_number === 'number' && c.likes_number) ||
            (typeof c.likes_number === 'string' &&
            !Number.isNaN(Number(c.likes_number))
              ? Number(c.likes_number)
              : 0) ||
            (typeof c.num_likes === 'number' && c.num_likes) ||
            (typeof c.num_likes === 'string' &&
            !Number.isNaN(Number(c.num_likes))
              ? Number(c.num_likes)
              : 0),
          num_replies:
            (typeof c.replies_number === 'number' && c.replies_number) ||
            (typeof c.replies_number === 'string' &&
            !Number.isNaN(Number(c.replies_number))
              ? Number(c.replies_number)
              : 0) ||
            (typeof c.num_replies === 'number' && c.num_replies) ||
            (typeof c.num_replies === 'string' &&
            !Number.isNaN(Number(c.num_replies))
              ? Number(c.num_replies)
              : 0),
          comment_id:
            (typeof c.comment_id === 'string' && c.comment_id) ||
            (typeof c.id === 'string' && c.id) ||
            null,
          date_created:
            (typeof c.comment_date === 'string' && c.comment_date) ||
            (typeof c.date_created === 'string' && c.date_created) ||
            (typeof c.created_at === 'string' && c.created_at) ||
            null,
        };
      });

      const prompt = `Analyze these Instagram post comments for suspicious activity and patterns.

Profile: ${profile}
Total Comments Analyzed: ${comments.length}
Comments Sample (showing up to 150):

${commentData
  .map(
    (c) => `
Comment ${c.index}:
- Commenter: ${c.commenter_user_name}
- Text: ${c.comment_text}
- Likes: ${c.num_likes}
- Replies: ${c.num_replies}
- Date: ${c.date_created || 'unknown'}
- Comment ID: ${c.comment_id || 'unknown'}`,
  )
  .join('\n')}

Please analyze these comments and identify suspicious activity patterns such as:

1. **Spam Comments**: Generic, repetitive, or promotional comments
2. **Bot Activity**: Comments that appear automated or fake
3. **Engagement Manipulation**: Unusual patterns in likes/replies that suggest manipulation
4. **Suspicious Commenters**: Accounts with suspicious patterns (e.g., all comments are generic, no engagement, etc.)
5. **Fake Engagement**: Comments that seem designed to inflate engagement metrics
6. **Pattern Analysis**: Any recurring suspicious patterns across multiple comments

Return your analysis as a JSON object with the following structure:
{
  "summary": "A comprehensive summary of suspicious activity findings (2-3 paragraphs)",
  "suspiciousCount": <number of comments identified as suspicious>,
  "suspiciousPercentage": <percentage of total comments that are suspicious>,
  "riskLevel": "<low/medium/high>",
  "patterns": [
    {
      "type": "<spam/bot/fake_engagement/etc>",
      "description": "<description of the pattern>",
      "examples": [<array of comment indices or IDs that match this pattern>],
      "severity": "<low/medium/high>"
    }
  ],
  "suspiciousComments": [
    {
      "commentIndex": <number>,
      "commentId": "<comment_id>",
      "reason": "<why this comment is suspicious>",
      "riskScore": <1-10>
    }
  ],
  "recommendations": "<recommendations based on findings>"
}

Risk Level Guidelines:
- low: Minimal suspicious activity, likely authentic engagement
- medium: Some suspicious patterns detected, mixed authenticity
- high: Significant suspicious activity, likely fake/bot engagement

Return ONLY the JSON object, no additional text or markdown formatting.`;

      const llmStartTime = Date.now();
      const response = await this.llmClient.invoke([new HumanMessage(prompt)]);
      const llmDuration = (Date.now() - llmStartTime) / 1000;

      const model = this.openrouterConfig.model || 'unknown';
      this.metricsService.recordLLMCall(model, 'instagram_comments_suspicious');
      this.metricsService.recordLLMCallDuration(
        model,
        'instagram_comments_suspicious',
        llmDuration,
        'success',
      );

      const responseText = response.content as string;
      return (
        safeJsonParseFromText<unknown>(responseText, 'object') ?? {
          summary:
            'LLM analysis completed but response parsing failed. Comments were collected successfully.',
          suspiciousCount: 0,
          suspiciousPercentage: 0,
          riskLevel: 'unknown',
          patterns: [],
          suspiciousComments: [],
          recommendations:
            'Unable to analyze comments due to parsing error. Review comments manually.',
          error: 'LLM response parsing failed',
        }
      );
    } catch (error) {
      const model = this.openrouterConfig.model || 'unknown';
      this.metricsService.recordLLMError(
        model,
        'instagram_comments_suspicious',
        'api_error',
      );
      this.logger.error('Error analyzing comments with LLM:', error);
      this.sentry.sendException(error);
      return {
        summary:
          'LLM analysis failed. Comments were collected but could not be analyzed for suspicious activity.',
        suspiciousCount: 0,
        suspiciousPercentage: 0,
        riskLevel: 'unknown',
        patterns: [],
        suspiciousComments: [],
        recommendations:
          'LLM analysis failed. Review comments manually to identify suspicious activity.',
        error: 'LLM analysis failed',
      };
    }
  }

  /**
   * Extracts structured context from a free-form user query about finding influencers.
   *
   * Uses OpenRouter with the `anthropic/claude-3.5-sonnet` model via LangChain.
   *
   * @param {string} query - The raw user query.
   *
   * @returns {Promise<InstagramSearchContext>} Parsed context object.
   */
  public async extractSearchContext(
    query: string,
  ): Promise<InstagramSearchContext> {
    try {
      const client = new ChatOpenAI({
        modelName: 'anthropic/claude-3.5-sonnet',
        openAIApiKey: this.openrouterConfig.apiKey,
        configuration: {
          baseURL: this.openrouterConfig.baseUrl,
          defaultHeaders: {
            'HTTP-Referer': 'https://wykra-api.com',
            'X-Title': 'Wykra API - Instagram Search',
          },
        },
        temperature: 0,
        timeout: this.openrouterConfig.timeout,
      });

      const prompt = `Extract structured context from the user query about finding influencers.

From the query, identify and return the following fields (leave empty if not provided):

category: the niche or topic the user wants (e.g., cooking, beauty, travel).

results_count: the number of influencers requested, if mentioned.

location: the geographic area (city, region, country) if mentioned.

followers_range: the desired follower count or range, if included.

Return the result strictly as a JSON object with these fields.

User query: '${query}'`;

      const llmStartTime = Date.now();
      const response = await client.invoke([new HumanMessage(prompt)]);
      const llmDuration = (Date.now() - llmStartTime) / 1000;
      const responseText = response.content as string;

      // Record token usage metrics (always record the call)
      const model = 'anthropic/claude-3.5-sonnet';
      this.metricsService.recordLLMCall(model, 'instagram_search_context');
      this.metricsService.recordLLMCallDuration(
        model,
        'instagram_search_context',
        llmDuration,
        'success',
      );

      // Extract usage from multiple possible locations
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;

      // Check response_metadata.tokenUsage (camelCase - Anthropic format)
      if (response.response_metadata?.tokenUsage) {
        const tokenUsage = response.response_metadata.tokenUsage;
        promptTokens = Number(tokenUsage.promptTokens) || 0;
        completionTokens = Number(tokenUsage.completionTokens) || 0;
        totalTokens = Number(tokenUsage.totalTokens) || 0;
      }
      // Check usage_metadata (snake_case - LangChain format)
      else if (response.usage_metadata) {
        promptTokens = Number(response.usage_metadata.input_tokens) || 0;
        completionTokens = Number(response.usage_metadata.output_tokens) || 0;
        totalTokens = Number(response.usage_metadata.total_tokens) || 0;
      }
      // Fallback: check response_metadata.usage (snake_case - OpenAI format)
      else if (response.response_metadata?.usage) {
        const usage = response.response_metadata.usage;
        promptTokens = Number(usage.prompt_tokens) || 0;
        completionTokens = Number(usage.completion_tokens) || 0;
        totalTokens = Number(usage.total_tokens) || 0;
      }

      // Record token usage metrics
      this.metricsService.recordLLMTokenUsage(
        model,
        'instagram_search_context',
        promptTokens,
        completionTokens,
        totalTokens,
      );
      this.metricsService.recordLLMTokensPerRequest(
        'search',
        promptTokens,
        completionTokens,
      );

      const parsed =
        safeJsonParseFromText<Partial<InstagramSearchContext>>(
          responseText,
          'object',
        ) ?? null;

      if (!parsed) {
        this.logger.warn(
          'Failed to parse Instagram search context JSON, using empty context',
        );
        this.sentry.sendException(new Error('Failed to parse JSON'), {
          rawResponse: responseText,
          query,
        });
      }

      return {
        category:
          parsed && typeof parsed.category === 'string'
            ? parsed.category
            : null,
        results_count:
          parsed && typeof parsed.results_count === 'number'
            ? parsed.results_count
            : parsed &&
                parsed.results_count &&
                !Number.isNaN(Number(parsed.results_count))
              ? Number(parsed.results_count)
              : null,
        location:
          parsed && typeof parsed.location === 'string'
            ? parsed.location
            : null,
        followers_range:
          parsed && typeof parsed.followers_range === 'string'
            ? parsed.followers_range
            : null,
      };
    } catch (error) {
      this.metricsService.recordLLMError(
        'anthropic/claude-3.5-sonnet',
        'instagram_search_context',
        'api_error',
      );

      this.logger.error(
        'Error extracting Instagram search context with OpenRouter:',
        error,
      );
      this.sentry.sendException(error, { query });

      return {
        category: null,
        results_count: null,
        location: null,
        followers_range: null,
      };
    }
  }

  /**
   * Fetches profile data from BrightData scraper API for Instagram.
   *
   * @param {string} profile - The Instagram profile username.
   *
   * @returns {Promise<InstagramProfile>} The raw profile data from the API.
   */
  private async fetchProfileData(profile: string): Promise<InstagramProfile> {
    const startTime = Date.now();
    try {
      this.logger.log(`Fetching Instagram profile data for: ${profile}`);

      // BrightData Instagram scraper API endpoint
      const endpoint = `/datasets/v3/scrape`;
      const datasetId = BrightdataDataset.INSTAGRAM;

      // Request body structure as per BrightData API
      const requestBody = {
        input: [{ user_name: profile }],
      };

      // Query parameters
      const params = {
        dataset_id: datasetId,
        notify: 'false',
        include_errors: 'true',
        type: 'discover_new',
        discover_by: 'user_name',
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
        BrightdataDataset.INSTAGRAM,
        'fetch_profile_data',
        duration,
      );

      this.logger.log(`Successfully fetched data for profile: ${profile}`);

      // BrightData returns an array with profile data, extract the first item
      if (Array.isArray(response.data) && response.data.length > 0) {
        return response.data[0] as InstagramProfile;
      }

      // If it's a single object, return it directly
      if (response.data && typeof response.data === 'object') {
        return response.data as InstagramProfile;
      }

      throw new Error(
        'Unexpected response format from BrightData API. Expected array with profile data or single profile object.',
      );
    } catch (error) {
      const axiosError = error as AxiosError;

      if (axiosError.response) {
        // API responded with error status
        const status = axiosError.response.status;
        const statusText = axiosError.response.statusText;
        const responseData = axiosError.response.data;

        this.logger.error(
          `BrightData API error for profile ${profile}: ${status} - ${statusText}`,
          responseData,
        );

        throw new Error(
          `Failed to fetch Instagram profile: ${statusText} (${status})`,
        );
      } else if (axiosError.request) {
        // Request was made but no response received
        this.logger.error(
          `No response from BrightData API for profile ${profile}`,
        );

        throw new Error('No response from Instagram scraper API');
      } else {
        // Error setting up the request
        this.logger.error(
          `Error setting up request for profile ${profile}:`,
          axiosError.message,
        );

        throw new Error(
          `Failed to fetch Instagram profile: ${axiosError.message}`,
        );
      }
    }
  }

  /**
   * Collects Instagram profile data from BrightData by profile URLs.
   *
   * Uses the "Instagram - Profiles - collect by URL" mode of the Instagram dataset.
   *
   * @param {string[]} urls - Array of Instagram profile URLs to collect.
   *
   * @returns {Promise<unknown[]>} Array of raw profile objects from BrightData.
   */
  public async collectProfilesByUrls(urls: string[]): Promise<unknown[]> {
    if (!urls.length) {
      return [];
    }

    const startTime = Date.now();
    try {
      this.logger.log(
        `Collecting Instagram profiles by URL from BrightData for ${urls.length} urls`,
      );

      const endpoint = `/datasets/v3/scrape`;
      const datasetId = BrightdataDataset.INSTAGRAM;

      // BrightData "collect by URL" mode expects profile URLs in the input
      const requestBody = {
        input: urls.map((url) => ({ url })),
      };

      const params = {
        dataset_id: datasetId,
        notify: 'false',
        include_errors: 'true',
        type: 'url_collection',
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
        BrightdataDataset.INSTAGRAM,
        'collect_profiles_by_urls',
        duration,
      );

      this.logger.log(
        `Successfully collected Instagram profiles by URL for ${urls.length} urls`,
      );

      const data = response.data;

      // BrightData often returns NDJSON (newline-delimited JSON) as a string
      if (typeof data === 'string') {
        const lines = data
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        const items: unknown[] = [];

        for (const line of lines) {
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;

            // Skip error entries like {"error_code":"dead_page", ...}
            if (obj.error_code) {
              continue;
            }

            items.push(obj);
          } catch {
            // Ignore malformed lines, we'll just skip them
          }
        }

        if (items.length > 0) {
          return items;
        }
      }

      if (Array.isArray(data)) {
        return data as unknown[];
      }

      if (data && typeof data === 'object') {
        return [data] as unknown[];
      }

      this.logger.warn(
        'Unexpected response format from BrightData collectProfilesByUrls, returning empty array',
      );
      return [];
    } catch (error) {
      const axiosError = error as AxiosError;

      if (axiosError.response) {
        const status = axiosError.response.status;
        const statusText = axiosError.response.statusText;
        const responseData = axiosError.response.data;

        this.logger.error(
          `BrightData API error for collectProfilesByUrls: ${status} - ${statusText}`,
          responseData,
        );

        this.sentry.sendException(error, { urls });

        throw new Error(
          `Failed to collect Instagram profiles by URL: ${statusText} (${status})`,
        );
      } else if (axiosError.request) {
        this.logger.error(
          'No response from BrightData API for collectProfilesByUrls',
        );

        this.sentry.sendException(error, { urls });

        throw new Error('No response from Instagram collect-by-URL API');
      } else {
        this.logger.error(
          'Error setting up request for collectProfilesByUrls:',
          axiosError.message,
        );

        this.sentry.sendException(error, { urls });

        throw new Error(
          `Failed to collect Instagram profiles by URL: ${axiosError.message}`,
        );
      }
    }
  }

  /**
   * Runs a short Anthropic analysis for each collected Instagram profile.
   *
   * @param {unknown[]} profiles - Raw profiles returned from BrightData.
   *
   * @returns {Promise<InstagramProfileAnalysis[]>} Array of profile URL + analysis JSON.
   */
  public async analyzeCollectedProfiles(
    taskId: string,
    profiles: unknown[],
  ): Promise<InstagramProfileAnalysis[]> {
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
          'X-Title': 'Wykra API - Instagram Profile Analysis',
        },
      },
      temperature: 0,
      timeout: this.openrouterConfig.timeout,
    });

    const analyses: InstagramProfileAnalysis[] = [];

    for (const profile of profiles) {
      const p = profile as Record<string, unknown>;
      const profileUrl =
        (typeof p.profile_url === 'string' && p.profile_url) ||
        (typeof p.url === 'string' && p.url);

      if (!profileUrl) {
        continue;
      }

      const account = typeof p.account === 'string' ? p.account : 'unknown';
      const followers = typeof p.followers === 'number' ? p.followers : null;
      const postsCount =
        typeof p.posts_count === 'number' ? p.posts_count : null;
      const isPrivate = typeof p.is_private === 'boolean' ? p.is_private : null;
      const isBusinessAccount =
        typeof p.is_business_account === 'boolean'
          ? p.is_business_account
          : null;
      const isProfessionalAccount =
        typeof p.is_professional_account === 'boolean'
          ? p.is_professional_account
          : null;
      const biography = typeof p.biography === 'string' ? p.biography : null;

      const prompt = `You are analyzing an Instagram profile for brand/influencer discovery.

Profile data (JSON):
${JSON.stringify(
  {
    account,
    profile_url: profileUrl,
    followers,
    posts_count: postsCount,
    is_private: isPrivate,
    is_business_account: isBusinessAccount,
    is_professional_account: isProfessionalAccount,
    biography,
  },
  null,
  2,
)}

Provide a very short evaluation of this profile's potential as a micro-influencer for brand collaborations.

Return ONLY a JSON object with the following shape:
{
  "summary": "1–3 sentence summary explaining the profile and why it is or is not a good fit.",
  "score": 1-5
}

Where:
- score 1 = very poor fit or unusable profile
- score 3 = average/acceptable
- score 5 = excellent, highly relevant and authentic.`;

      try {
        const llmStartTime = Date.now();
        const response = await client.invoke([new HumanMessage(prompt)]);
        const llmDuration = (Date.now() - llmStartTime) / 1000;
        const responseText = response.content as string;

        // Record token usage metrics (always record the call)
        const model = 'anthropic/claude-3.5-sonnet';
        this.metricsService.recordLLMCall(model, 'instagram_profile_analysis');
        this.metricsService.recordLLMCallDuration(
          model,
          'instagram_profile_analysis',
          llmDuration,
          'success',
        );

        // Extract usage from multiple possible locations
        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;

        // Check response_metadata.tokenUsage (camelCase - Anthropic format)
        if (response.response_metadata?.tokenUsage) {
          const tokenUsage = response.response_metadata.tokenUsage;
          promptTokens = Number(tokenUsage.promptTokens) || 0;
          completionTokens = Number(tokenUsage.completionTokens) || 0;
          totalTokens = Number(tokenUsage.totalTokens) || 0;
        }
        // Check usage_metadata (snake_case - LangChain format)
        else if (response.usage_metadata) {
          promptTokens = Number(response.usage_metadata.input_tokens) || 0;
          completionTokens = Number(response.usage_metadata.output_tokens) || 0;
          totalTokens = Number(response.usage_metadata.total_tokens) || 0;
        }
        // Fallback: check response_metadata.usage (snake_case - OpenAI format)
        else if (response.response_metadata?.usage) {
          const usage = response.response_metadata.usage;
          promptTokens = Number(usage.prompt_tokens) || 0;
          completionTokens = Number(usage.completion_tokens) || 0;
          totalTokens = Number(usage.total_tokens) || 0;
        }

        // Record token usage metrics
        this.metricsService.recordLLMTokenUsage(
          model,
          'instagram_profile_analysis',
          promptTokens,
          completionTokens,
          totalTokens,
        );
        this.metricsService.recordLLMTokensPerRequest(
          'instagram',
          promptTokens,
          completionTokens,
        );

        let parsed: {
          summary?: string;
          score?: number;
        } = {};

        try {
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          const jsonString = jsonMatch ? jsonMatch[0] : responseText;
          parsed = JSON.parse(jsonString) as {
            summary?: string;
            score?: number;
          };
        } catch (parseError) {
          this.logger.warn(
            'Failed to parse Anthropic profile analysis JSON, using fallback analysis',
            parseError,
          );
          this.sentry.sendException(parseError, {
            rawResponse: responseText,
            profileUrl,
          });
        }

        const summary =
          typeof parsed.summary === 'string' && parsed.summary.length > 0
            ? parsed.summary
            : `Basic analysis for ${account} (${profileUrl}). Followers: ${
                followers ?? 'unknown'
              }, posts: ${postsCount ?? 'unknown'}.`;

        let score =
          typeof parsed.score === 'number' && !Number.isNaN(parsed.score)
            ? parsed.score
            : 3;

        if (score < 1 || score > 5) {
          score = 3;
        }

        const analysis = {
          profileUrl,
          analysis: {
            summary,
            score,
          },
        };

        analyses.push(analysis);

        // Persist this profile immediately after analysis
        try {
          await this.searchProfilesRepo.createMany([
            {
              taskId,
              account,
              profileUrl,
              followers,
              isPrivate,
              isBusinessAccount,
              isProfessionalAccount,
              analysisSummary: summary,
              analysisScore: score,
              raw: JSON.stringify(p),
            },
          ]);
        } catch (saveError) {
          this.logger.error(
            `Failed to save InstagramSearchProfile for ${profileUrl}`,
            saveError,
          );
          this.sentry.sendException(saveError, { profileUrl, taskId });
        }
      } catch (error) {
        this.metricsService.recordLLMError(
          'anthropic/claude-3.5-sonnet',
          'instagram_profile_analysis',
          'api_error',
        );

        this.logger.error(
          `Error analyzing Instagram profile with Anthropic: ${profileUrl}`,
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
   * Processes profile data using OpenRouter LLM API.
   *
   * @param {InstagramProfile} profileData - The raw profile data to process.
   *
   * @returns {Promise<InstagramAnalysisResult>} The LLM-processed analysis.
   */
  private async processWithLLM(
    profileData: InstagramProfile,
  ): Promise<InstagramAnalysisResult> {
    try {
      this.logger.log('Processing profile data with OpenRouter LLM');

      // Check if profile is private or data is unsuitable
      if (profileData.is_private) {
        return {
          summary: 'Profile is private. Cannot analyze private profiles.',
          qualityScore: 0,
          message: 'Profile is private and cannot be analyzed.',
        };
      }

      // Check if we have minimum required data
      if (
        !profileData.account ||
        !profileData.followers ||
        profileData.posts_count === 0
      ) {
        return {
          summary:
            'Insufficient data available for analysis. Profile may be new or have limited activity.',
          qualityScore: 0,
          message: 'Data is not suitable for evaluation.',
        };
      }

      // Extract relevant fields for analysis
      const analysisData = {
        account: profileData.account,
        profile_name: profileData.profile_name,
        followers: profileData.followers || 0,
        posts_count: profileData.posts_count || 0,
        avg_engagement: profileData.avg_engagement || 0,
        biography: profileData.biography,
        is_verified: profileData.is_verified,
        is_business_account: profileData.is_business_account,
        is_professional_account: profileData.is_professional_account,
        posts: (profileData.posts || []).slice(0, 10).map((post) => ({
          caption: post.caption,
          likes: post.likes || 0,
          comments: post.comments || 0,
          content_type: post.content_type,
          hashtags: this.extractHashtags((post.caption as string) || ''),
        })),
      };

      // Create comprehensive prompt for LLM analysis
      const prompt = `Analyze this Instagram influencer profile data and provide a detailed analysis.

Profile Data:
- Account: ${analysisData.account || 'Unknown'}
- Profile Name: ${analysisData.profile_name || 'Unknown'}
- Followers: ${(analysisData.followers || 0).toLocaleString()}
- Posts Count: ${analysisData.posts_count || 0}
- Average Engagement Rate: ${((analysisData.avg_engagement || 0) * 100).toFixed(2)}%
- Biography: ${analysisData.biography || 'No biography'}
- Verified: ${analysisData.is_verified ? 'Yes' : 'No'}
- Business Account: ${analysisData.is_business_account ? 'Yes' : 'No'}
- Professional Account: ${analysisData.is_professional_account ? 'Yes' : 'No'}

Recent Posts Sample:
${analysisData.posts
  .map(
    (post, idx) => `
Post ${idx + 1}:
- Caption: ${post.caption?.substring(0, 200) || 'No caption'}
- Likes: ${(post.likes || 0).toLocaleString()}
- Comments: ${(post.comments || 0).toLocaleString()}
- Type: ${post.content_type || 'Unknown'}
- Hashtags: ${post.hashtags?.join(', ') || 'None'}`,
  )
  .join('\n')}

Please analyze this profile and provide a comprehensive analysis covering:

1. **Core Themes/Topics**: What are the main themes of the profile (e.g., fashion/GRWM styling, personal style mixing casual and elegant pieces, travel and lifestyle, family/friendship moments, beauty and skincare routines, food and dining, cultural experiences and events)? How would you describe the creator's overall positioning?
2. **Sponsored Content (Frequency & Fit)**: Are they sponsored frequently? How often do you see sponsored content and brand collaborations, and do these partnerships feel natural and on-brand?
3. **Content Authenticity**: Does the content feel authentic and personal versus overly polished, AI-generated, or artificial? How genuine do the creator's style and recommendations feel?
4. **Follower Authenticity**: Are their followers likely real or do you see signs of fake/bought followers (suspicious follower counts, low engagement relative to audience size, generic or bot-like comments)?
5. **Visible Brands & Commercial Activity**: What brands are visible in their content or collaborations (for example, fashion/beauty or lifestyle brands)? Do they mix paid and organic mentions, and do they maintain authenticity in sponsored content?
6. **Engagement Strength & Patterns**: How strong is the engagement overall (likes, comments, saves) and what patterns do you see (e.g., highest engagement on outfit transformations/GRWM reels, travel content, personal/relatable moments, high-quality fashion photography)? Comment on the quality of conversations in the comments and any signs of community building or brand recognition/reposts.
7. **Posts vs Reels Performance**: Compare performance of different content formats (reels vs photo posts/carousels). Note typical views/likes ranges if visible, which formats drive better engagement (e.g., outfit transition reels, styling reels, photo carousels showing multiple angles/details), and how consistent that performance is.
8. **Posting Consistency & Aesthetic**: Analyze how often they post, how consistent they are over time, and whether they maintain a regular mix of reels vs photo posts. Comment on recurring content series/hashtags (e.g., GRWM or custom series hashtags), overall aesthetic and visual consistency, and whether they tend to post during peak engagement times.
9. **Posts Analysis (Content & Quality)**: Analyze the posting patterns in more depth: content quality, creativity, storytelling, use of transitions, framing, and how well the content showcases outfits, travel, lifestyle, and personal moments.
10. **Hashtags Statistics & Series**: What hashtags do they use most? Are they relevant to their niche and content themes? Identify any branded/series hashtags (like GRWM or custom ones) and how they support discoverability and positioning.

Return your analysis as a JSON object with the following structure:
{
  'summary': 'A comprehensive 2-3 paragraph summary of the profile analysis',
  'qualityScore': <number from 1 to 5>,
  'topic': '<main topic/niche>',
  'niche': '<specific niche if applicable>',
  'sponsoredFrequency': '<low/medium/high>',
  'contentAuthenticity': '<authentic/artificial/mixed>',
  'followerAuthenticity': '<likely real/likely fake/mixed>',
  'visibleBrands': ['<brand1>', '<brand2>', ...],
  'engagementStrength': '<weak/moderate/strong>',
  'postsAnalysis': '<detailed analysis of posts, including posts vs reels performance, core themes, and posting consistency>',
  'hashtagsStatistics': '<analysis of hashtag usage, including key themes and recurring/series hashtags>'
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

      // Record token usage metrics (always record the call)
      const model = this.openrouterConfig.model || 'unknown';
      this.metricsService.recordLLMCall(model, 'instagram_profile_analysis');
      this.metricsService.recordLLMCallDuration(
        model,
        'instagram_profile_analysis',
        llmDuration,
        'success',
      );

      // Extract usage from multiple possible locations
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;

      // Check response_metadata.tokenUsage (camelCase - Anthropic format)
      if (response.response_metadata?.tokenUsage) {
        const tokenUsage = response.response_metadata.tokenUsage;
        promptTokens = Number(tokenUsage.promptTokens) || 0;
        completionTokens = Number(tokenUsage.completionTokens) || 0;
        totalTokens = Number(tokenUsage.totalTokens) || 0;
      }
      // Check usage_metadata (snake_case - LangChain format)
      else if (response.usage_metadata) {
        promptTokens = Number(response.usage_metadata.input_tokens) || 0;
        completionTokens = Number(response.usage_metadata.output_tokens) || 0;
        totalTokens = Number(response.usage_metadata.total_tokens) || 0;
      }
      // Fallback: check response_metadata.usage (snake_case - OpenAI format)
      else if (response.response_metadata?.usage) {
        const usage = response.response_metadata.usage;
        promptTokens =
          typeof usage.prompt_tokens === 'number'
            ? usage.prompt_tokens
            : Number(usage.prompt_tokens) || 0;
        completionTokens =
          typeof usage.completion_tokens === 'number'
            ? usage.completion_tokens
            : Number(usage.completion_tokens) || 0;
        totalTokens =
          typeof usage.total_tokens === 'number'
            ? usage.total_tokens
            : Number(usage.total_tokens) || 0;
      }

      // Record token usage metrics
      this.metricsService.recordLLMTokenUsage(
        model,
        'instagram_profile_analysis',
        promptTokens,
        completionTokens,
        totalTokens,
      );
      this.metricsService.recordLLMTokensPerRequest(
        'instagram',
        promptTokens,
        completionTokens,
      );

      // Parse the LLM response
      const responseText = response.content as string;
      let analysis: InstagramAnalysisResult;

      try {
        // Try to extract JSON from the response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          analysis = JSON.parse(responseText);
        }

        // Validate and ensure quality score is between 1-5
        if (
          analysis.qualityScore &&
          (analysis.qualityScore < 1 || analysis.qualityScore > 5)
        ) {
          this.logger.warn(
            `Invalid quality score ${analysis.qualityScore}, defaulting to 3`,
          );
          analysis.qualityScore = 3;
        }

        // Ensure required fields
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

        // Fallback: create basic analysis
        const engagementOk = profileData.avg_engagement >= 0.01;
        const postsOk = profileData.posts_count >= 10;
        const qualityScore = engagementOk && postsOk ? 3 : 2;

        analysis = {
          summary: `Profile analysis for ${analysisData.account || 'Unknown'}. ${(analysisData.followers || 0).toLocaleString()} followers, ${analysisData.posts_count || 0} posts, ${((analysisData.avg_engagement || 0) * 100).toFixed(2)}% average engagement rate.`,
          qualityScore,
          topic: 'Unable to determine from available data',
          engagementStrength: engagementOk ? 'moderate' : 'weak',
          message: 'LLM response parsing failed, using basic analysis.',
        };
      }

      return analysis;
    } catch (error) {
      this.logger.error('Error processing profile with LLM:', error);
      this.sentry.sendException(error);

      // Fallback analysis if LLM fails
      const engagementOk = profileData.avg_engagement >= 0.01;
      const postsOk = profileData.posts_count >= 10;
      const qualityScore = engagementOk && postsOk ? 3 : 2;

      return {
        summary: `Basic analysis for ${profileData.account || 'Unknown'}. Profile has ${(profileData.followers || 0).toLocaleString()} followers and ${profileData.posts_count || 0} posts.`,
        qualityScore,
        engagementStrength: engagementOk ? 'moderate' : 'weak',
        message: 'LLM analysis failed, using fallback analysis.',
      };
    }
  }

  /**
   * Extracts hashtags from a caption text.
   *
   * @param {string} caption - The caption text to extract hashtags from.
   *
   * @returns {string[]} Array of hashtags found in the caption.
   */
  private extractHashtags(caption: string): string[] {
    if (!caption) {
      return [];
    }

    const hashtagRegex = /#[\w]+/g;
    const matches = caption.match(hashtagRegex);

    return matches ? matches.map((tag) => tag.substring(1)) : [];
  }

  /**
   * Creates a new Instagram search job and queues it for processing.
   *
   * @param {string} query - The search query string.
   *
   * @returns {Promise<string>} The task ID.
   */
  public async search(query: string): Promise<string> {
    const taskId = randomUUID();

    // Create task record in database
    await this.tasksRepo.create({
      taskId,
      status: TaskStatus.Pending,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
    });

    // Queue the search job for processing
    await this.queueService.instagram.add('search', {
      taskId,
      query,
    });

    // Record task creation metric
    this.metricsService.recordTaskCreated('instagram_search');

    return taskId;
  }
}
