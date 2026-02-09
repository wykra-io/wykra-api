import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { QueueName } from '@libs/queue';
import { TaskStatus } from '@libs/entities';
import { TasksRepository } from '@libs/repositories';
import { SentryClientService } from '@libs/sentry';

import { MetricsService } from '../metrics';
import { TaskCancellationService } from '../tasks/task-cancellation.service';
import { TikTokService } from './tiktok.service';

interface TikTokSearchJobData {
  taskId: string;
  query: string;
}

interface TikTokProfileJobData {
  taskId: string;
  profile: string;
}

interface TikTokCommentsSuspiciousJobData {
  taskId: string;
  profile: string;
}

@Processor(QueueName.TikTok)
export class TikTokProcessor {
  private readonly logger = new Logger(TikTokProcessor.name);
  // NOTE: Search profiles functionality is temporarily disabled (kept in codebase, but blocked at runtime).
  private static readonly SEARCH_PROFILES_DISABLED = false;
  private static readonly RETRYABLE_ERROR_PATTERNS: RegExp[] = [
    /brightdata/i,
    /timed out/i,
    /timeout/i,
    /econnreset/i,
    /etimedout/i,
    /enotfound/i,
    /eai_again/i,
    /socket hang up/i,
    /\b429\b/i,
    /\b503\b/i,
  ];

  constructor(
    private readonly tasksRepo: TasksRepository,
    private readonly sentry: SentryClientService,
    private readonly tiktokService: TikTokService,
    private readonly metricsService: MetricsService,
    private readonly taskCancellation: TaskCancellationService,
  ) {}

  private isCancelledError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return /aborted|cancelled|canceled/i.test(msg);
  }

  /**
   * Processes a TikTok search job.
   */
  @Process('search')
  public async search(job: Job<TikTokSearchJobData>): Promise<void> {
    const { taskId, query } = job.data;
    const startTime = Date.now();
    const controller = this.taskCancellation.register(taskId);
    const signal = controller.signal;

    // Track queue wait time
    const queuedAt = job.timestamp;
    const waitTime = (startTime - queuedAt) / 1000;
    this.metricsService.recordTaskQueueWaitTime(
      'tiktok_search',
      'tiktok',
      waitTime,
    );

    try {
      const existing = await this.tasksRepo.findOneByTaskId(taskId);
      if (existing?.status === TaskStatus.Cancelled) {
        return;
      }
      if (TikTokProcessor.SEARCH_PROFILES_DISABLED) {
        await this.tasksRepo.update(taskId, {
          status: TaskStatus.Failed,
          error: 'TikTok profile search is currently disabled.',
          completedAt: new Date(),
        });
        this.metricsService.recordTaskStatusChange('failed', 'tiktok_search');
        this.logger.warn(
          `TikTok search task ${taskId} skipped (disabled). Query: ${query}`,
        );
        return;
      }

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Running,
        startedAt: new Date(),
      });

      this.logger.log(
        `TikTok search task ${taskId} started for query: ${query}`,
      );
      this.metricsService.recordTaskStatusChange('running', 'tiktok_search');

      const context = await this.tiktokService.extractSearchContext(query, {
        signal,
      });

      const baseTerm = [context.category, context.location]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .join(' ');

      const searchTerms: string[] =
        context.search_terms && context.search_terms.length > 0
          ? context.search_terms
          : baseTerm
            ? [baseTerm]
            : [];

      if (searchTerms.length === 0) {
        throw new Error('No search terms could be determined from the query');
      }

      const country: string =
        typeof context.country_code === 'string' &&
        context.country_code.length === 2
          ? context.country_code
          : 'US';

      // BrightData TikTok dataset: Discover by multiple search URLs
      const discoveredProfiles: unknown[] = [];

      const profileByUrl = new Map<string, unknown>();

      const addProfilesToMap = (profiles: unknown[]) => {
        for (const profile of profiles) {
          const obj = profile as Record<string, unknown>;
          const profileUrl =
            (typeof obj.profile_url === 'string' && obj.profile_url) ||
            (typeof obj.url === 'string' && obj.url) ||
            (typeof obj.profileUrl === 'string' && obj.profileUrl) ||
            null;

          if (profileUrl && !profileByUrl.has(profileUrl)) {
            profileByUrl.set(profileUrl, profile);
          }
        }
      };

      const searchUrls = searchTerms.slice(0, 3).map((term) => {
        return `https://www.tiktok.com/search?q=${encodeURIComponent(term)}`;
      });

      if (searchUrls.length > 0) {
        const batch = await this.tiktokService.discoverProfilesBySearchUrl(
          searchUrls,
          country,
          { signal },
        );
        addProfilesToMap(batch);
      }

      discoveredProfiles.push(...profileByUrl.values());

      const analyzedProfiles =
        discoveredProfiles.length > 0
          ? await this.tiktokService.analyzeCollectedProfiles(
              taskId,
              discoveredProfiles,
              query,
              { signal },
            )
          : [];

      // Exclude private profiles and profiles rated 1/5 (same logic as Instagram).
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

      const result = JSON.stringify({
        query,
        context,
        searchTerms,
        discoveredCount: discoveredProfiles.length,
        analyzedProfiles: sortedAnalyzedProfiles,
      });

      const processingDuration = (Date.now() - startTime) / 1000;

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Completed,
        result,
        completedAt: new Date(),
      });

      this.metricsService.recordTaskCompleted(
        processingDuration,
        'tiktok_search',
      );
      this.logger.log(`TikTok search task ${taskId} completed successfully`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const processingDuration = (Date.now() - startTime) / 1000;

      if (this.isCancelledError(error)) {
        this.logger.log(`TikTok search task ${taskId} was cancelled`);
        await this.tasksRepo.update(taskId, {
          status: TaskStatus.Cancelled,
          error: 'Cancelled by user',
          completedAt: new Date(),
        });
        this.metricsService.recordTaskStatusChange('failed', 'tiktok_search');
        return;
      }

      this.logger.error(
        `TikTok search task ${taskId} failed: ${errorMessage}`,
        errorStack,
      );

      this.sentry.sendException(error, { taskId, query });

      const totalAttempts =
        typeof job.opts.attempts === 'number' && job.opts.attempts > 0
          ? job.opts.attempts
          : 1;
      const attemptsMade =
        typeof job.attemptsMade === 'number' ? job.attemptsMade : 0;
      const hasRemainingAttempts = attemptsMade + 1 < totalAttempts;

      const isRetryable =
        hasRemainingAttempts &&
        TikTokProcessor.RETRYABLE_ERROR_PATTERNS.some((re) =>
          re.test(errorMessage),
        );

      if (isRetryable) {
        // Mark back to pending so the UI doesn't show a permanent failure while Bull retries.
        await this.tasksRepo.update(taskId, {
          status: TaskStatus.Pending,
          error: `Retrying (${attemptsMade + 1}/${totalAttempts}): ${errorMessage}`,
          startedAt: null,
          completedAt: null,
        });
        // Throw so Bull performs the retry attempt.
        throw error;
      }

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Failed,
        error: errorMessage,
        completedAt: new Date(),
      });

      this.metricsService.recordTaskFailed(processingDuration, 'tiktok_search');
    } finally {
      this.taskCancellation.cleanup(taskId);
    }
  }

  /**
   * Processes a TikTok profile analysis job.
   */
  @Process('profile')
  public async profile(job: Job<TikTokProfileJobData>): Promise<void> {
    const { taskId, profile } = job.data;
    const startTime = Date.now();
    const controller = this.taskCancellation.register(taskId);
    const signal = controller.signal;

    // Track queue wait time
    const queuedAt = job.timestamp;
    const waitTime = (startTime - queuedAt) / 1000;
    this.metricsService.recordTaskQueueWaitTime(
      'tiktok_profile',
      'tiktok',
      waitTime,
    );

    try {
      const existing = await this.tasksRepo.findOneByTaskId(taskId);
      if (existing?.status === TaskStatus.Cancelled) {
        return;
      }
      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Running,
        startedAt: new Date(),
      });

      this.logger.log(
        `TikTok profile task ${taskId} started for profile: ${profile}`,
      );
      this.metricsService.recordTaskStatusChange('running', 'tiktok_profile');

      // This internally uses BrightData trigger -> poll -> snapshot download (runDatasetAndDownload)
      const data = await this.tiktokService.analyzeProfile(profile, { signal });

      const result = JSON.stringify(data);
      const processingDuration = (Date.now() - startTime) / 1000;

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Completed,
        result,
        completedAt: new Date(),
      });

      this.metricsService.recordTaskCompleted(
        processingDuration,
        'tiktok_profile',
      );
      this.logger.log(`TikTok profile task ${taskId} completed successfully`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const processingDuration = (Date.now() - startTime) / 1000;

      if (this.isCancelledError(error)) {
        this.logger.log(`TikTok profile task ${taskId} was cancelled`);
        await this.tasksRepo.update(taskId, {
          status: TaskStatus.Cancelled,
          error: 'Cancelled by user',
          completedAt: new Date(),
        });
        this.metricsService.recordTaskFailed(
          processingDuration,
          'tiktok_profile',
        );
        return;
      }

      this.logger.error(
        `TikTok profile task ${taskId} failed: ${errorMessage}`,
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
        'tiktok_profile',
      );
    } finally {
      this.taskCancellation.cleanup(taskId);
    }
  }

  /**
   * Processes a TikTok suspicious-comments analysis job.
   */
  @Process('comments_suspicious')
  public async suspiciousComments(
    job: Job<TikTokCommentsSuspiciousJobData>,
  ): Promise<void> {
    const { taskId, profile } = job.data;
    const startTime = Date.now();
    const controller = this.taskCancellation.register(taskId);
    const signal = controller.signal;

    const queuedAt = job.timestamp;
    const waitTime = (startTime - queuedAt) / 1000;
    this.metricsService.recordTaskQueueWaitTime(
      'tiktok_comments_suspicious',
      'tiktok',
      waitTime,
    );

    try {
      const existing = await this.tasksRepo.findOneByTaskId(taskId);
      if (existing?.status === TaskStatus.Cancelled) {
        return;
      }
      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Running,
        startedAt: new Date(),
      });

      this.logger.log(
        `TikTok comments suspicious task ${taskId} started for profile: ${profile}`,
      );
      this.metricsService.recordTaskStatusChange(
        'running',
        'tiktok_comments_suspicious',
      );

      const data = await this.tiktokService.analyzeSuspiciousComments(profile, {
        signal,
      });
      const result = JSON.stringify(data);
      const processingDuration = (Date.now() - startTime) / 1000;

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Completed,
        result,
        completedAt: new Date(),
      });

      this.metricsService.recordTaskCompleted(
        processingDuration,
        'tiktok_comments_suspicious',
      );
      this.logger.log(
        `TikTok comments suspicious task ${taskId} completed successfully`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const processingDuration = (Date.now() - startTime) / 1000;

      if (this.isCancelledError(error)) {
        this.logger.log(`TikTok comments suspicious task ${taskId} was cancelled`);
        await this.tasksRepo.update(taskId, {
          status: TaskStatus.Cancelled,
          error: 'Cancelled by user',
          completedAt: new Date(),
        });
        this.metricsService.recordTaskFailed(
          processingDuration,
          'tiktok_comments_suspicious',
        );
        return;
      }

      this.logger.error(
        `TikTok comments suspicious task ${taskId} failed: ${errorMessage}`,
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
        'tiktok_comments_suspicious',
      );
    } finally {
      this.taskCancellation.cleanup(taskId);
    }
  }
}
