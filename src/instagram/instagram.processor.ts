import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { QueueName } from '@libs/queue';
import { TaskStatus } from '@libs/entities';
import {
  InstagramSearchProfilesRepository,
  TasksRepository,
} from '@libs/repositories';
import { SentryClientService } from '@libs/sentry';

import { MetricsService } from '../metrics';
import { PerplexityService } from '../perplexity';
import { InstagramService } from './instagram.service';

interface InstagramSearchJobData {
  taskId: string;
  query: string;
}

interface InstagramCommentsSuspiciousJobData {
  taskId: string;
  profile: string;
}

interface InstagramProfileJobData {
  taskId: string;
  profile: string;
}

@Processor(QueueName.Instagram)
export class InstagramProcessor {
  private readonly logger = new Logger(InstagramProcessor.name);

  constructor(
    private readonly tasksRepo: TasksRepository,
    private readonly sentry: SentryClientService,
    private readonly perplexityService: PerplexityService,
    private readonly instagramService: InstagramService,
    private readonly searchProfilesRepo: InstagramSearchProfilesRepository,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Processes an Instagram search job.
   *
   * @param {Job<InstagramSearchJobData>} job - A job instance containing search details.
   *
   * @returns void
   */
  @Process('search')
  public async search(job: Job<InstagramSearchJobData>): Promise<void> {
    const { taskId, query } = job.data;
    const startTime = Date.now();

    // Track queue wait time
    const queuedAt = job.timestamp; // Time when job was added to queue
    const waitTime = (startTime - queuedAt) / 1000;
    this.metricsService.recordTaskQueueWaitTime(
      'instagram_search',
      'instagram',
      waitTime,
    );

    try {
      // Update task status to running
      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Running,
        startedAt: new Date(),
      });

      this.logger.log(
        `Instagram search task ${taskId} started for query: ${query}`,
      );
      this.metricsService.recordTaskStatusChange('running', 'instagram_search');

      // First step: extract structured context from the user query
      const context = await this.instagramService.extractSearchContext(query);

      // Category is required – fail fast if it's missing
      if (!context.category) {
        throw new Error('Category is required to perform Instagram search');
      }

      // Build a precise search prompt for Perplexity using extracted context
      const categoryPart = `who post about ${context.category}`;
      const locationPart = context.location ? `from ${context.location}` : '';

      let followersPart = '';
      if (context.followers_range) {
        followersPart = ` and have at least ${context.followers_range} followers`;
      }

      /**
       * STAGE 1: Strict high-confidence URL discovery prompt
       *
       * Example base prompt (with context injected):
       * "Find public Instagram accounts from Portugal who post about cooking.
       *
       *  Only include accounts for which you have a verified direct URL to instagram.com from credible web sources.
       *  (Return only Instagram URLs that appear in these external sources.)
       *  Do not invent usernames.
       *  If uncertain, exclude the account.
       *  Return only the list of URLs with no extra text"
       */
      const stage1Prompt = `Find public Instagram accounts ${locationPart} ${categoryPart}${followersPart}.

Only include accounts for which you have a verified direct URL to instagram.com from credible web sources.
(Return only Instagram URLs that appear in these external sources.)
Do not invent usernames.
If uncertain, exclude the account.
Return only the list of URLs with no extra text.`;

      const stage1Response = await this.perplexityService.chat({
        message: stage1Prompt,
      });

      const urlRegex = /https?:\/\/[^\s]+/g;

      const rawContentStage1 = stage1Response.content;
      const allUrlsStage1 =
        typeof rawContentStage1 === 'string'
          ? rawContentStage1.match(urlRegex) || []
          : [];
      const instagramUrlsStage1 = allUrlsStage1.filter((url) =>
        url.toLowerCase().includes('instagram.com'),
      );

      // Fetch detailed profile data for Stage 1 URLs via BrightData
      const stage1Profiles =
        instagramUrlsStage1.length > 0
          ? await this.instagramService.collectProfilesByUrls(
              instagramUrlsStage1,
            )
          : [];

      // Parse Instagram profile URLs from BrightData profiles
      const parsedInstagramUrlsStage1 = stage1Profiles
        .map((p) => {
          const obj = p as Record<string, unknown>;
          const profileUrl =
            (typeof obj.profile_url === 'string' && obj.profile_url) ||
            (typeof obj.url === 'string' && obj.url) ||
            null;
          return profileUrl;
        })
        .filter((url): url is string => !!url && url.includes('instagram.com'));

      let combinedProfiles = [...stage1Profiles];
      let combinedInstagramUrls = [...new Set(instagramUrlsStage1)];

      /**
       * STAGE 2: Fallback search using the previous, more permissive prompt
       * Triggered only if we have fewer than 5 unique Instagram URLs
       * parsed from BrightData profiles in Stage 1.
       */
      let stage2Prompt: string | null = null;
      let stage2ResponseContent: string | null = null;
      let stage2Usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      } | null = null;

      if (parsedInstagramUrlsStage1.length < 5) {
        const baseInstruction = `Find public Instagram accounts ${locationPart} ${categoryPart}${followersPart}.`;

        stage2Prompt = `${baseInstruction}

Use open-web search results and external sources such as websites, Linktree/Beacons, YouTube/TikTok links, or press mentions to identify their Instagram handles.

Return only Instagram URLs that appear in these external sources. 

Do not invent usernames.

If uncertain, exclude the account. 

Return only the list of URLs with no extra text.`;

        const stage2Response = await this.perplexityService.chat({
          message: stage2Prompt,
        });

        // Metrics are already recorded in PerplexityService.chat()
        // But we log the usage for debugging
        this.logger.log(
          `Stage 2 Perplexity call completed. Usage: ${JSON.stringify(stage2Response.usage)}`,
        );

        stage2ResponseContent = stage2Response.content;
        stage2Usage = stage2Response.usage
          ? {
              promptTokens: stage2Response.usage.promptTokens || 0,
              completionTokens: stage2Response.usage.completionTokens || 0,
              totalTokens: stage2Response.usage.totalTokens || 0,
            }
          : {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            };

        const allUrlsStage2 =
          typeof stage2ResponseContent === 'string'
            ? stage2ResponseContent.match(urlRegex) || []
            : [];
        const instagramUrlsStage2 = allUrlsStage2.filter((url) =>
          url.toLowerCase().includes('instagram.com'),
        );

        // Deduplicate URLs between stages
        const newStage2Urls = instagramUrlsStage2.filter(
          (url) => !combinedInstagramUrls.includes(url),
        );

        const stage2Profiles =
          newStage2Urls.length > 0
            ? await this.instagramService.collectProfilesByUrls(newStage2Urls)
            : [];

        // Merge profiles, preferring first occurrence
        const profileByUrl = new Map<string, unknown>();

        const addProfilesToMap = (profiles: unknown[]) => {
          for (const profile of profiles) {
            const obj = profile as Record<string, unknown>;
            const profileUrl =
              (typeof obj.profile_url === 'string' && obj.profile_url) ||
              (typeof obj.url === 'string' && obj.url) ||
              null;

            if (
              profileUrl &&
              profileUrl.includes('instagram.com') &&
              !profileByUrl.has(profileUrl)
            ) {
              profileByUrl.set(profileUrl, profile);
            }
          }
        };

        addProfilesToMap(stage1Profiles);
        addProfilesToMap(stage2Profiles);

        combinedProfiles = Array.from(profileByUrl.values());
        combinedInstagramUrls = Array.from(
          new Set([...combinedInstagramUrls, ...instagramUrlsStage2]),
        );
      }

      // Run short Anthropic analysis for each collected profile and
      // persist each profile to the database as it is analyzed
      const analyzedProfiles =
        combinedProfiles.length > 0
          ? await this.instagramService.analyzeCollectedProfiles(
              taskId,
              combinedProfiles,
            )
          : [];

      // Calculate aggregate usage from all LLM calls
      const stage1Usage = stage1Response.usage
        ? {
            promptTokens: stage1Response.usage.promptTokens || 0,
            completionTokens: stage1Response.usage.completionTokens || 0,
            totalTokens: stage1Response.usage.totalTokens || 0,
          }
        : {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          };

      // Task completed successfully
      const result = JSON.stringify({
        query,
        context,
        // For backwards compatibility, keep "searchPrompt" pointing to the
        // final prompt used (Stage 2 if executed, otherwise Stage 1).
        searchPrompt: stage2Prompt || stage1Prompt,
        stage1Prompt,
        stage2Prompt,
        stage1Response: rawContentStage1,
        stage2Response: stage2ResponseContent,
        instagramUrls: combinedInstagramUrls,
        analyzedProfiles,
        usage: {
          stage1: stage1Usage,
          stage2: stage2Usage,
          total: {
            promptTokens:
              (stage1Usage.promptTokens || 0) +
              (stage2Usage?.promptTokens || 0),
            completionTokens:
              (stage1Usage.completionTokens || 0) +
              (stage2Usage?.completionTokens || 0),
            totalTokens:
              (stage1Usage.totalTokens || 0) + (stage2Usage?.totalTokens || 0),
          },
        },
        model: stage1Response.model,
      });

      const processingDuration = (Date.now() - startTime) / 1000;

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Completed,
        result,
        completedAt: new Date(),
      });

      // Record task completion metric
      this.metricsService.recordTaskCompleted(
        processingDuration,
        'instagram_search',
      );

      this.logger.log(`Instagram search task ${taskId} completed successfully`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const processingDuration = (Date.now() - startTime) / 1000;

      this.logger.error(
        `Instagram search task ${taskId} failed: ${errorMessage}`,
        errorStack,
      );

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Failed,
        error: errorMessage,
        completedAt: new Date(),
      });

      // Record task failure metric
      this.metricsService.recordTaskFailed(
        processingDuration,
        'instagram_search',
      );
    }
  }

  /**
   * Processes an Instagram profile analysis job.
   */
  @Process('profile')
  public async profile(job: Job<InstagramProfileJobData>): Promise<void> {
    const { taskId, profile } = job.data;
    const startTime = Date.now();

    // Track queue wait time
    const queuedAt = job.timestamp;
    const waitTime = (startTime - queuedAt) / 1000;
    this.metricsService.recordTaskQueueWaitTime(
      'instagram_profile',
      'instagram',
      waitTime,
    );

    try {
      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Running,
        startedAt: new Date(),
      });

      this.logger.log(
        `Instagram profile task ${taskId} started for profile: ${profile}`,
      );
      this.metricsService.recordTaskStatusChange(
        'running',
        'instagram_profile',
      );

      const data = await this.instagramService.analyzeProfile(profile);
      const result = JSON.stringify(data);
      const processingDuration = (Date.now() - startTime) / 1000;

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Completed,
        result,
        completedAt: new Date(),
      });

      this.metricsService.recordTaskCompleted(
        processingDuration,
        'instagram_profile',
      );
      this.logger.log(
        `Instagram profile task ${taskId} completed successfully`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Instagram profile task ${taskId} failed: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      this.sentry.sendException(error, { taskId, profile });

      const processingDuration = (Date.now() - startTime) / 1000;
      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Failed,
        error: errorMessage,
        completedAt: new Date(),
      });

      this.metricsService.recordTaskFailed(
        processingDuration,
        'instagram_profile',
      );
      this.metricsService.recordTaskStatusChange('failed', 'instagram_profile');
    }
  }

  /**
   * Processes an Instagram suspicious-comments analysis job.
   */
  @Process('comments_suspicious')
  public async suspiciousComments(
    job: Job<InstagramCommentsSuspiciousJobData>,
  ): Promise<void> {
    const { taskId, profile } = job.data;
    const startTime = Date.now();

    const queuedAt = job.timestamp;
    const waitTime = (startTime - queuedAt) / 1000;
    this.metricsService.recordTaskQueueWaitTime(
      'instagram_comments_suspicious',
      'instagram',
      waitTime,
    );

    try {
      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Running,
        startedAt: new Date(),
      });

      this.logger.log(
        `Instagram comments suspicious task ${taskId} started for profile: ${profile}`,
      );
      this.metricsService.recordTaskStatusChange(
        'running',
        'instagram_comments_suspicious',
      );

      const data =
        await this.instagramService.analyzeSuspiciousComments(profile);
      const result = JSON.stringify(data);
      const processingDuration = (Date.now() - startTime) / 1000;

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Completed,
        result,
        completedAt: new Date(),
      });

      this.metricsService.recordTaskCompleted(
        processingDuration,
        'instagram_comments_suspicious',
      );
      this.logger.log(
        `Instagram comments suspicious task ${taskId} completed successfully`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const processingDuration = (Date.now() - startTime) / 1000;

      this.logger.error(
        `Instagram comments suspicious task ${taskId} failed: ${errorMessage}`,
        errorStack,
      );
      this.sentry.sendException(error, { taskId, profile });

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Failed,
        error: errorMessage,
        completedAt: new Date(),
      });

      this.metricsService.recordTaskFailed(
        processingDuration,
        'instagram_comments_suspicious',
      );
    }
  }
}
