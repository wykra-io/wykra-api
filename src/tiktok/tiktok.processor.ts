import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { QueueName } from '@libs/queue';
import { TaskStatus } from '@libs/entities';
import { TasksRepository } from '@libs/repositories';
import { SentryClientService } from '@libs/sentry';

import { MetricsService } from '../metrics';
import { TikTokService } from './tiktok.service';

interface TikTokSearchJobData {
  taskId: string;
  query: string;
}

@Processor(QueueName.TikTok)
export class TikTokProcessor {
  private readonly logger = new Logger(TikTokProcessor.name);

  constructor(
    private readonly tasksRepo: TasksRepository,
    private readonly sentry: SentryClientService,
    private readonly tiktokService: TikTokService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Processes a TikTok search job.
   */
  @Process('search')
  public async search(job: Job<TikTokSearchJobData>): Promise<void> {
    const { taskId, query } = job.data;
    const startTime = Date.now();

    // Track queue wait time
    const queuedAt = job.timestamp;
    const waitTime = (startTime - queuedAt) / 1000;
    this.metricsService.recordTaskQueueWaitTime(
      'tiktok_search',
      'tiktok',
      waitTime,
    );

    try {
      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Running,
        startedAt: new Date(),
      });

      this.logger.log(
        `TikTok search task ${taskId} started for query: ${query}`,
      );
      this.metricsService.recordTaskStatusChange('running', 'tiktok_search');

      const context = await this.tiktokService.extractSearchContext(query);

      if (!context.category) {
        throw new Error('Category is required to perform TikTok search');
      }

      const baseTerm = [context.category, context.location]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .join(' ');

      const searchTerms =
        (Array.isArray(context.search_terms) &&
          context.search_terms.length > 0 &&
          context.search_terms) ||
        (baseTerm ? [baseTerm] : []);

      const country =
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

      for (const term of searchTerms.slice(0, 3)) {
        const searchUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(
          term,
        )}`;

        const batch = await this.tiktokService.discoverProfilesBySearchUrl(
          searchUrl,
          country,
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
            )
          : [];

      const result = JSON.stringify({
        query,
        context,
        searchTerms,
        discoveredCount: discoveredProfiles.length,
        analyzedProfiles,
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

      this.logger.error(
        `TikTok search task ${taskId} failed: ${errorMessage}`,
        errorStack,
      );

      this.sentry.sendException(error, { taskId, query });

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Failed,
        error: errorMessage,
        completedAt: new Date(),
      });

      this.metricsService.recordTaskFailed(processingDuration, 'tiktok_search');
    }
  }
}
