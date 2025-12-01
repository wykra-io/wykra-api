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

import { PerplexityService } from '../perplexity';
import { InstagramService } from './instagram.service';

interface InstagramSearchJobData {
  taskId: string;
  query: string;
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

    try {
      // Update task status to running
      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Running,
        startedAt: new Date(),
      });

      this.logger.log(
        `Instagram search task ${taskId} started for query: ${query}`,
      );

      // First step: extract structured context from the user query
      const context = await this.instagramService.extractSearchContext(query);

      // Category is required – fail fast if it's missing
      if (!context.category) {
        throw new Error('Category is required to perform Instagram search');
      }

      // Build a precise search prompt for Perplexity using extracted context
      const categoryPart = `who post about ${context.category}`;

      //const hasResultsCount =
      //typeof context.results_count === 'number' && context.results_count > 0;
      //const resultsCount = hasResultsCount ? context.results_count : null;

      const locationPart = context.location ? `from ${context.location}` : '';

      let followersPart = '';
      if (context.followers_range) {
        followersPart = ` and have at least ${context.followers_range} followers`;
      }

      const baseInstruction = `Find public Instagram accounts ${locationPart} ${categoryPart}${followersPart}.`;

      const searchPrompt = `${baseInstruction}

Use open-web search results and external sources such as websites, Linktree/Beacons, YouTube/TikTok links, or press mentions to identify their Instagram handles.

Return only Instagram URLs that appear in these external sources. 

Do not invent usernames.

If uncertain, exclude the account. 

Return only the list of URLs with no extra text.`;

      const searchResponse = await this.perplexityService.chat({
        message: searchPrompt,
      });

      const rawContent = searchResponse.content;
      const urlRegex = /https?:\/\/[^\s]+/g;
      const allUrls =
        typeof rawContent === 'string' ? rawContent.match(urlRegex) || [] : [];
      const instagramUrls = allUrls.filter((url) =>
        url.toLowerCase().includes('instagram.com'),
      );

      // Fetch detailed profile data for collected URLs via BrightData
      const profiles =
        instagramUrls.length > 0
          ? await this.instagramService.collectProfilesByUrls(instagramUrls)
          : [];

      // Run short DeepSeek analysis for each collected profile and
      // persist each profile to the database as it is analyzed
      const analyzedProfiles =
        profiles.length > 0
          ? await this.instagramService.analyzeCollectedProfiles(
              taskId,
              profiles,
            )
          : [];

      // Task completed successfully
      const result = JSON.stringify({
        query,
        context,
        searchPrompt,
        response: rawContent,
        instagramUrls,
        analyzedProfiles,
        usage: searchResponse.usage,
        model: searchResponse.model,
      });

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Completed,
        result,
        completedAt: new Date(),
      });

      this.logger.log(`Instagram search task ${taskId} completed successfully`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Instagram search task ${taskId} failed: ${errorMessage}`,
        errorStack,
      );

      await this.tasksRepo.update(taskId, {
        status: TaskStatus.Failed,
        error: errorMessage,
        completedAt: new Date(),
      });
    }
  }
}
