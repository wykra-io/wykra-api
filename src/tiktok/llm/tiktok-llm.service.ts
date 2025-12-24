import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { Injectable, Logger } from '@nestjs/common';

import { OpenrouterConfigService } from '@libs/config';
import { SentryClientService } from '@libs/sentry';
import { safeJsonParseFromText } from '@libs/utils';

import { MetricsService } from '../../metrics';
import {
  TikTokAnalysisResult,
  TikTokProfile,
  TikTokSearchContext,
} from '../interfaces';
import { extractHashtags, normalizeCountryCode } from '../utils/tiktok.utils';

@Injectable()
export class TikTokLLMService {
  private readonly logger = new Logger(TikTokLLMService.name);
  private readonly defaultClient: ChatOpenAI;
  private readonly sonnetClient: ChatOpenAI;

  /**
   * Checks if a string contains emojis
   */
  private containsEmoji(text: string): boolean {
    // Unicode ranges for emojis
    const emojiRegex =
      /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{200D}]|[\u{203C}]|[\u{2049}]|[\u{2122}]|[\u{2139}]|[\u{2194}-\u{2199}]|[\u{21A9}-\u{21AA}]|[\u{231A}-\u{231B}]|[\u{2328}]|[\u{2388}]|[\u{23CF}]|[\u{23E9}-\u{23F3}]|[\u{23F8}-\u{23FA}]|[\u{24C2}]|[\u{25AA}-\u{25AB}]|[\u{25B6}]|[\u{25C0}]|[\u{25FB}-\u{25FE}]|[\u{2600}-\u{2604}]|[\u{260E}]|[\u{2611}]|[\u{2614}-\u{2615}]|[\u{2618}]|[\u{261D}]|[\u{2620}]|[\u{2622}-\u{2623}]|[\u{2626}]|[\u{262A}]|[\u{262E}-\u{262F}]|[\u{2638}-\u{263A}]|[\u{2640}]|[\u{2642}]|[\u{2648}-\u{2653}]|[\u{2660}]|[\u{2663}]|[\u{2665}-\u{2666}]|[\u{2668}]|[\u{267B}]|[\u{267E}-\u{267F}]|[\u{2692}-\u{2697}]|[\u{2699}]|[\u{269B}-\u{269C}]|[\u{26A0}-\u{26A1}]|[\u{26AA}-\u{26AB}]|[\u{26B0}-\u{26B1}]|[\u{26BD}-\u{26BE}]|[\u{26C4}-\u{26C5}]|[\u{26C8}]|[\u{26CE}-\u{26CF}]|[\u{26D1}]|[\u{26D3}-\u{26D4}]|[\u{26E9}-\u{26EA}]|[\u{26F0}-\u{26F5}]|[\u{26F7}-\u{26FA}]|[\u{26FD}]|[\u{2702}]|[\u{2705}]|[\u{2708}-\u{270D}]|[\u{270F}]|[\u{2712}]|[\u{2714}]|[\u{2716}]|[\u{271D}]|[\u{2721}]|[\u{2728}]|[\u{2733}-\u{2734}]|[\u{2744}]|[\u{2747}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2763}-\u{2764}]|[\u{2795}-\u{2797}]|[\u{27A1}]|[\u{27B0}]|[\u{27BF}]|[\u{2934}-\u{2935}]|[\u{2B05}-\u{2B07}]|[\u{2B1B}-\u{2B1C}]|[\u{2B50}]|[\u{2B55}]|[\u{3030}]|[\u{303D}]|[\u{3297}]|[\u{3299}]/u;
    return emojiRegex.test(text);
  }

  constructor(
    private readonly openrouterConfig: OpenrouterConfigService,
    private readonly sentry: SentryClientService,
    private readonly metricsService: MetricsService,
  ) {
    // OpenRouter uses OpenAI-compatible API
    const baseConfig = {
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
    };

    this.defaultClient = new ChatOpenAI({
      ...baseConfig,
      modelName: this.openrouterConfig.model,
    });

    this.sonnetClient = new ChatOpenAI({
      ...baseConfig,
      modelName: 'anthropic/claude-3.5-sonnet',
    });
  }

  public async analyzeProfile(profileData: TikTokProfile): Promise<TikTokAnalysisResult> {
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
          hashtags: extractHashtags(caption),
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
      const response = await this.defaultClient.invoke([new HumanMessage(prompt)]);
      const llmDuration = (Date.now() - llmStartTime) / 1000;

      const model = this.openrouterConfig.model || 'unknown';
      this.metricsService.recordLLMCall(model, 'tiktok_profile_analysis');
      this.metricsService.recordLLMCallDuration(
        model,
        'tiktok_profile_analysis',
        llmDuration,
        'success',
      );

      const responseText = response.content as string;
      const parsed =
        safeJsonParseFromText<TikTokAnalysisResult>(responseText, 'object') ??
        null;

      if (!parsed) {
        return {
          summary: `Profile analysis for ${account}. ${followers.toLocaleString()} followers.`,
          qualityScore: 3,
          topic: 'Unable to determine from available data',
          engagementStrength: 'moderate',
          message: 'LLM response parsing failed, using basic analysis.',
        };
      }

      if (
        parsed.qualityScore &&
        (parsed.qualityScore < 1 || parsed.qualityScore > 5)
      ) {
        parsed.qualityScore = 3;
      }
      if (!parsed.summary) {
        parsed.summary = 'Analysis completed but summary not provided.';
      }
      if (!parsed.qualityScore) {
        parsed.qualityScore = 3;
      }

      return parsed;
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

  public async extractSearchContext(query: string): Promise<TikTokSearchContext> {
    try {
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
      const response = await this.sonnetClient.invoke([new HumanMessage(prompt)]);
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
      const countryCode = normalizeCountryCode(rawCountryCode || rawLocation);

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
            : parsed.results_count && !Number.isNaN(Number(parsed.results_count))
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
      this.logger.error('Error extracting TikTok search context with LLM:', error);
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

  public async analyzeCollectedProfileShort(
    profile: unknown,
    query: string,
  ): Promise<{ summary: string; score: number; relevance: number }> {
    const p = profile as Record<string, unknown>;

    const profileUrl =
      (typeof p.profile_url === 'string' && p.profile_url) ||
      (typeof p.url === 'string' && p.url) ||
      (typeof p.profileUrl === 'string' && p.profileUrl) ||
      null;

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

    const response = await this.sonnetClient.invoke([new HumanMessage(prompt)]);
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
        : `Basic analysis for ${account} (${profileUrl ?? 'unknown'}). Followers: ${
            followers ?? 'unknown'
          }.`;

    let score =
      typeof parsed.score === 'number' && !Number.isNaN(parsed.score)
        ? parsed.score
        : 3;
    if (score < 1 || score > 5) {
      score = 3;
    }

    let relevance =
      typeof parsed.relevance === 'number'
        ? parsed.relevance
        : typeof parsed.relevance_percent === 'number'
          ? parsed.relevance_percent
          : 100;
    if (!Number.isFinite(relevance)) {
      relevance = 100;
    }
    if (relevance < 0) {
      relevance = 0;
    } else if (relevance > 100) {
      relevance = 100;
    }

    return { summary, score, relevance };
  }

  public async analyzeCommentsForSuspiciousActivity(
    comments: unknown[],
    profile: string,
  ): Promise<unknown> {
    try {
      const commentData = comments.slice(0, 150).map((comment, idx) => {
        const c = (comment || {}) as Record<string, unknown>;
        return {
          index: idx + 1,
          comment_text:
            (typeof c.comment_text === 'string' && c.comment_text) || '',
          commenter_user_name:
            (typeof c.commenter_user_name === 'string' &&
              c.commenter_user_name) ||
            'unknown',
          num_likes:
            (typeof c.num_likes === 'number' && c.num_likes) ||
            (typeof c.num_likes === 'string' && !Number.isNaN(Number(c.num_likes))
              ? Number(c.num_likes)
              : 0),
          num_replies:
            (typeof c.num_replies === 'number' && c.num_replies) ||
            (typeof c.num_replies === 'string' &&
            !Number.isNaN(Number(c.num_replies))
              ? Number(c.num_replies)
              : 0),
          comment_id:
            (typeof c.comment_id === 'string' && c.comment_id) || null,
          date_created:
            (typeof c.date_created === 'string' && c.date_created) || null,
        };
      });

      const prompt = `Analyze these TikTok video comments for suspicious activity and patterns.

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

**IMPORTANT**: Do NOT mark comments containing emojis as suspicious. Comments with emojis are considered normal, authentic engagement and should be excluded from suspicious activity analysis.

Please analyze these comments and identify suspicious activity patterns such as:

1. **Spam Comments**: Generic, repetitive, or promotional comments (excluding those with emojis)
2. **Bot Activity**: Comments that appear automated or fake (excluding those with emojis)
3. **Engagement Manipulation**: Unusual patterns in likes/replies that suggest manipulation (excluding comments with emojis)
4. **Suspicious Commenters**: Accounts with suspicious patterns (e.g., all comments are generic, no engagement, etc.) - but exclude commenters whose comments contain emojis
5. **Fake Engagement**: Comments that seem designed to inflate engagement metrics (excluding those with emojis)
6. **Pattern Analysis**: Any recurring suspicious patterns across multiple comments (excluding comments with emojis)

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
      const response = await this.defaultClient.invoke([new HumanMessage(prompt)]);
      const llmDuration = (Date.now() - llmStartTime) / 1000;

      const model = this.openrouterConfig.model || 'unknown';
      this.metricsService.recordLLMCall(
        model,
        'tiktok_comments_suspicious_analysis',
      );
      this.metricsService.recordLLMCallDuration(
        model,
        'tiktok_comments_suspicious_analysis',
        llmDuration,
        'success',
      );

      const responseText = response.content as string;

      const analysisResult = safeJsonParseFromText<{
        summary?: string;
        suspiciousCount?: number;
        suspiciousPercentage?: number;
        riskLevel?: string;
        patterns?: unknown[];
        suspiciousComments?: Array<{
          commentIndex?: number;
          commentId?: string;
          reason?: string;
          riskScore?: number;
        }>;
        recommendations?: string;
        error?: string;
      }>(responseText, 'object');

      if (!analysisResult) {
        return {
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
        };
      }

      // Filter out comments with emojis from suspicious comments list
      if (
        analysisResult.suspiciousComments &&
        Array.isArray(analysisResult.suspiciousComments)
      ) {
        const originalCount = analysisResult.suspiciousComments.length;
        analysisResult.suspiciousComments =
          analysisResult.suspiciousComments.filter((suspiciousComment) => {
            // Find the original comment text
            const originalComment = commentData.find(
              (c) => c.index === suspiciousComment.commentIndex,
            );
            if (
              originalComment &&
              this.containsEmoji(originalComment.comment_text)
            ) {
              return false; // Exclude comments with emojis
            }
            return true;
          });

        // Update counts after filtering
        const filteredCount = analysisResult.suspiciousComments.length;
        if (originalCount !== filteredCount) {
          analysisResult.suspiciousCount = filteredCount;
          if (comments.length > 0) {
            analysisResult.suspiciousPercentage =
              Math.round((filteredCount / comments.length) * 100 * 100) / 100;
          }
        }
      }

      return analysisResult;
    } catch (error) {
      const model = this.openrouterConfig.model || 'unknown';
      this.metricsService.recordLLMError(
        model,
        'tiktok_comments_suspicious_analysis',
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
}

