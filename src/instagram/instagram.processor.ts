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

        stage2ResponseContent = stage2Response.content;

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
        usage: stage1Response.usage,
        model: stage1Response.model,
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
