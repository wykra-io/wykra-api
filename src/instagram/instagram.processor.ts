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
import { InstagramService } from './instagram.service';
import { InstagramWebSearchService } from './instagram-web-search.service';

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
    private readonly instagramService: InstagramService,
    private readonly searchProfilesRepo: InstagramSearchProfilesRepository,
    private readonly metricsService: MetricsService,
    private readonly webSearchService: InstagramWebSearchService,
  ) {}

  /**
   * Finds previously discovered Instagram profile URLs for similar search contexts.
   *
   * "Similar" here means same category, location, and followers_range (if present),
   * based on the structured context stored in completed instagram_search task results.
   */
  private async getExcludedInstagramUrlsForContext(context: {
    category: string | null;
    location: string | null;
    followers_range: string | null;
  }): Promise<string[]> {
    const results = new Set<string>();

    // Look at a reasonable number of recent completed tasks to avoid heavy scans.
    const recentTasks = await this.tasksRepo.findRecentCompleted(50);

    for (const task of recentTasks) {
      if (!task.result) continue;

      try {
        const parsed = JSON.parse(task.result) as {
          context?: {
            category?: string | null;
            location?: string | null;
            followers_range?: string | null;
          };
          analyzedProfiles?: Array<{ profileUrl?: string }>;
        };

        if (!parsed.context || !parsed.analyzedProfiles) continue;

        const sameCategory =
          (parsed.context.category || '').trim().toLowerCase() ===
          (context.category || '').trim().toLowerCase();
        const sameLocation =
          (parsed.context.location || '').trim().toLowerCase() ===
          (context.location || '').trim().toLowerCase();
        const sameFollowersRange =
          (parsed.context.followers_range || '').trim() ===
          (context.followers_range || '').trim();

        if (!sameCategory || !sameLocation || !sameFollowersRange) {
          continue;
        }

        for (const profile of parsed.analyzedProfiles) {
          if (
            profile?.profileUrl &&
            typeof profile.profileUrl === 'string' &&
            profile.profileUrl.includes('instagram.com')
          ) {
            results.add(profile.profileUrl);
          }
        }
      } catch {
        // Ignore malformed results from unrelated tasks
      }
    }

    return Array.from(results);
  }

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

      // Determine which profiles to exclude based on similar past searches
      const excludedInstagramUrls =
        await this.getExcludedInstagramUrlsForContext(context);

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
      const excludePart =
        excludedInstagramUrls.length > 0
          ? `\nExclude these profiles that were already found in previous similar searches:\n${excludedInstagramUrls
              .slice(0, 20)
              .join('\n')}\n`
          : '';

      const stage1Prompt = `Find public Instagram accounts ${locationPart} ${categoryPart}${followersPart}.

Only include accounts with verified instagram.com URLs from credible sources.
${excludePart}Return ONLY URLs, one per line, no explanations.
Do not invent usernames.`;

      const stage1Response = await this.webSearchService.searchUrls(
        stage1Prompt,
        1,
      );

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
      let stage1Profiles =
        instagramUrlsStage1.length > 0
          ? await this.instagramService.collectProfilesByUrls(
              instagramUrlsStage1,
            )
          : [];

      if (!stage1Profiles.length && instagramUrlsStage1.length > 0) {
        this.logger.warn(
          `BrightData collectProfilesByUrls returned no profiles for ${instagramUrlsStage1.length} urls, falling back to per-profile scrape`,
        );
        stage1Profiles =
          await this.instagramService.fetchProfilesForUrls(instagramUrlsStage1);
      }

      // Stage 2 is disabled - only use Stage 1 results
      const combinedProfiles = [...stage1Profiles];

      // Stage 2 variables (kept for backwards compatibility in result JSON)
      const stage2Prompt: string | null = null;
      const stage2ResponseContent: string | null = null;
      type UsageStats = {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
      const stage2Usage: UsageStats | null = null;

      // Run short Anthropic analysis for each collected profile and
      // persist each profile to the database as it is analyzed
      const analyzedProfiles =
        combinedProfiles.length > 0
          ? await this.instagramService.analyzeCollectedProfiles(
              taskId,
              combinedProfiles,
            )
          : [];

      // Exclude private profiles and profiles rated 1/5 from search results.
      // Sort remaining results by rating (highest first), then by followers.
      const filteredProfiles = analyzedProfiles.filter((p) => {
        if (p.isPrivate === true) return false;
        const score =
          typeof p.analysis?.score === 'number' &&
          !Number.isNaN(p.analysis.score)
            ? p.analysis.score
            : 0;
        return score > 1;
      });

      const sortedAnalyzedProfiles = [...filteredProfiles].sort((a, b) => {
        const aScore =
          typeof a.analysis?.score === 'number' &&
          !Number.isNaN(a.analysis.score)
            ? a.analysis.score
            : 0;
        const bScore =
          typeof b.analysis?.score === 'number' &&
          !Number.isNaN(b.analysis.score)
            ? b.analysis.score
            : 0;
        if (aScore !== bScore) return bScore - aScore;

        const aFollowers =
          typeof a.followers === 'number' && !Number.isNaN(a.followers)
            ? a.followers
            : -1;
        const bFollowers =
          typeof b.followers === 'number' && !Number.isNaN(b.followers)
            ? b.followers
            : -1;
        return bFollowers - aFollowers;
      });

      // URLs in the result should match the profiles we return (excluded ones removed)
      const resultInstagramUrls = sortedAnalyzedProfiles.map(
        (p) => p.profileUrl,
      );

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
      const stage2UsageSafe: UsageStats = stage2Usage ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

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
        instagramUrls: resultInstagramUrls,
        analyzedProfiles: sortedAnalyzedProfiles,
        usage: {
          stage1: stage1Usage,
          stage2: stage2Usage,
          total: {
            promptTokens:
              (stage1Usage.promptTokens || 0) +
              (stage2UsageSafe.promptTokens || 0),
            completionTokens:
              (stage1Usage.completionTokens || 0) +
              (stage2UsageSafe.completionTokens || 0),
            totalTokens:
              (stage1Usage.totalTokens || 0) +
              (stage2UsageSafe.totalTokens || 0),
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
