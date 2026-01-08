import { GoneException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { BrightdataDataset } from '@libs/config';
import { TaskStatus } from '@libs/entities';
import { QueueService } from '@libs/queue';
import {
  TikTokSearchProfilesRepository,
  TasksRepository,
} from '@libs/repositories';
import { SentryClientService } from '@libs/sentry';

import { MetricsService } from '../metrics';
import {
  TikTokAnalysisData,
  TikTokProfile,
  TikTokSearchContext,
} from './interfaces';
import { TikTokBrightdataService } from './brightdata/tiktok-brightdata.service';
import { TikTokLLMService } from './llm/tiktok-llm.service';
import { normalizeTikTokProfileUrl } from './utils/tiktok.utils';

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
  // NOTE: Search profiles functionality is temporarily disabled (kept in codebase, but blocked at runtime).
  private static readonly SEARCH_PROFILES_DISABLED = true;

  constructor(
    private readonly brightdata: TikTokBrightdataService,
    private readonly llm: TikTokLLMService,
    private readonly sentry: SentryClientService,
    private readonly queueService: QueueService,
    private readonly tasksRepo: TasksRepository,
    private readonly searchProfilesRepo: TikTokSearchProfilesRepository,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Scrapes and analyzes a TikTok profile by fetching data from BrightData
   * and processing the results using LLM.
   */
  public async analyzeProfile(profile: string): Promise<TikTokAnalysisData> {
    try {
      this.logger.log(`Starting analysis for TikTok profile: ${profile}`);

      const profileData = await this.fetchProfileData(profile);
      const analysis = await this.llm.analyzeProfile(profileData);

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

  public async extractSearchContext(
    query: string,
  ): Promise<TikTokSearchContext> {
    return this.llm.extractSearchContext(query);
  }

  /**
   * Fetches profile data from BrightData for a TikTok profile (username or URL).
   */
  private async fetchProfileData(profile: string): Promise<TikTokProfile> {
    const url = normalizeTikTokProfileUrl(profile);
    this.logger.log(`Fetching TikTok profile data for: ${profile} (${url})`);

    const items = await this.brightdata.runDatasetAndDownload(
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
  }

  /**
   * Collects TikTok profile data from BrightData by profile URLs.
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
      return await this.brightdata.runDatasetAndDownload(
        BrightdataDataset.TIKTOK,
        triggerBody,
        {
          notify: 'false',
          type: 'url_collection',
        },
        'collect_profiles_by_urls',
      );
    } catch (error) {
      this.sentry.sendException(error, { urls });
      throw error;
    }
  }

  /**
   * Discovers TikTok creator profiles by TikTok search URL(s) using BrightData dataset mode:
   * type=discover_new&discover_by=search_url
   */
  public async discoverProfilesBySearchUrl(
    searchUrls: string | string[],
    country = 'US',
  ): Promise<unknown[]> {
    try {
      const urls = Array.isArray(searchUrls) ? searchUrls : [searchUrls];
      const triggerBody = urls.map((url) => ({
        search_url: url,
        country,
      }));

      return await this.brightdata.runDatasetAndDownload(
        BrightdataDataset.TIKTOK,
        triggerBody,
        {
          notify: 'false',
          type: 'discover_new',
          discover_by: 'search_url',
          limit_per_input: '10',
        },
        'discover_by_search_url',
      );
    } catch (error) {
      this.logger.error(
        'Error discovering TikTok profiles by search URL',
        error,
      );
      this.sentry.sendException(error, { searchUrls, country });
      throw error;
    }
  }

  /**
   * Runs a short LLM analysis for each collected TikTok profile and persists it.
   */
  public async analyzeCollectedProfiles(
    taskId: string,
    profiles: unknown[],
    query: string,
  ): Promise<TikTokProfileAnalysis[]> {
    if (!profiles.length) {
      return [];
    }

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

      try {
        const { summary, score, relevance } =
          await this.llm.analyzeCollectedProfileShort(profile, query);

        // Skip profiles that are less than 70% relevant to the query
        if (relevance < 70) {
          continue;
        }

        analyses.push({
          profileUrl,
          analysis: { summary, score },
        });

        // Persist this profile immediately after analysis
        if (!TikTokService.SEARCH_PROFILES_DISABLED) {
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
   * Analyzes suspicious comments for a TikTok profile by scraping comments from their videos.
   */
  public async analyzeSuspiciousComments(profile: string): Promise<unknown> {
    try {
      this.logger.log(
        `Starting suspicious comments analysis for TikTok profile: ${profile}`,
      );

      // First, fetch the profile data to get video URLs
      const profileData = await this.fetchProfileData(profile);
      const p = profileData as Record<string, unknown>;

      // Extract video URLs from the profile (try multiple dataset shapes)
      const rawVideos =
        (Array.isArray(p.top_videos) && p.top_videos) ||
        (Array.isArray(p.top_posts_data) && p.top_posts_data) ||
        (Array.isArray(p.videos) && p.videos) ||
        (Array.isArray(p.posts) && p.posts) ||
        (Array.isArray(p.recent_videos) && p.recent_videos) ||
        (Array.isArray(p.items) && p.items) ||
        [];

      const videoUrls: string[] = [];
      const seenUrls = new Set<string>();

      for (const video of rawVideos.slice(0, 5)) {
        const v = (video || {}) as Record<string, unknown>;
        const videoUrl =
          (typeof v.video_url === 'string' && v.video_url) ||
          (typeof v.post_url === 'string' && v.post_url) ||
          (typeof v.url === 'string' && v.url) ||
          (typeof v.videoUrl === 'string' && v.videoUrl) ||
          null;

        if (
          videoUrl &&
          videoUrl.includes('tiktok.com') &&
          !seenUrls.has(videoUrl)
        ) {
          videoUrls.push(videoUrl);
          seenUrls.add(videoUrl);
        }
      }

      if (videoUrls.length === 0) {
        this.logger.warn(
          `No video URLs found for profile ${profile} to scrape comments`,
        );
        return {
          profile,
          videosAnalyzed: 0,
          message: 'No videos found to analyze comments',
        };
      }

      const allComments = await this.brightdata.runDatasetAndDownload(
        BrightdataDataset.TIKTOK_VIDEO_COMMENTS,
        videoUrls.map((url) => ({ url })),
        {
          notify: 'false',
          limit_per_input: '50',
        },
        'scrape_video_comments',
      );

      let suspiciousAnalysis: unknown = null;
      if (allComments.length > 0) {
        try {
          this.logger.log(
            `Analyzing ${allComments.length} comments for suspicious activity with LLM`,
          );
          suspiciousAnalysis =
            await this.llm.analyzeCommentsForSuspiciousActivity(
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
        videosAnalyzed: videoUrls.length,
        totalComments: allComments.length,
        videoUrls,
        analysis: suspiciousAnalysis,
      };
    } catch (error) {
      this.logger.error(
        `Error analyzing suspicious comments for TikTok profile ${profile}:`,
        error,
      );
      this.sentry.sendException(error, { profile });
      throw error;
    }
  }

  /**
   * Creates a new TikTok search job and queues it for processing.
   */
  public async search(query: string): Promise<string> {
    if (TikTokService.SEARCH_PROFILES_DISABLED) {
      this.logger.warn(
        `TikTok search requested while disabled. Query=${JSON.stringify(query)}`,
      );
      throw new GoneException('TikTok profile search is currently disabled.');
    }

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

  /**
   * Creates a new TikTok suspicious comments analysis job and queues it for processing.
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

    await this.queueService.tiktok.add('comments_suspicious', {
      taskId,
      profile,
    });

    this.metricsService.recordTaskCreated('tiktok_comments_suspicious');

    return taskId;
  }
}
