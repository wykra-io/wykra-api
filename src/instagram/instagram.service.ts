import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { Injectable, Logger } from "@nestjs/common";
import axios, { AxiosInstance, AxiosError } from "axios";

import { BrightdataConfigService, OpenrouterConfigService } from "@libs/config";
import { SentryClientService } from "@libs/sentry";

import {
  InstagramAnalysisData,
  InstagramAnalysisResult,
  InstagramProfile,
} from "./interfaces";

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  private readonly httpClient: AxiosInstance;
  private readonly llmClient: ChatOpenAI;

  constructor(
    private readonly brightdataConfig: BrightdataConfigService,
    private readonly openrouterConfig: OpenrouterConfigService,
    private readonly sentry: SentryClientService,
  ) {
    this.httpClient = axios.create({
      baseURL: this.brightdataConfig.baseUrl,
      timeout: this.brightdataConfig.timeout,
      headers: {
        Authorization: `Bearer ${this.brightdataConfig.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    // Initialize OpenRouter LLM client (OpenRouter uses OpenAI-compatible API)
    this.llmClient = new ChatOpenAI({
      modelName: this.openrouterConfig.model,
      openAIApiKey: this.openrouterConfig.apiKey,
      configuration: {
        baseURL: this.openrouterConfig.baseUrl,
        defaultHeaders: {
          "HTTP-Referer": "https://wykra-api.com",
          "X-Title": "Wykra API",
        },
      },
      temperature: 0,
      timeout: this.openrouterConfig.timeout,
    });
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
   * Fetches profile data from BrightData scraper API for Instagram.
   *
   * @param {string} profile - The Instagram profile username.
   *
   * @returns {Promise<InstagramProfile>} The raw profile data from the API.
   */
  private async fetchProfileData(profile: string): Promise<InstagramProfile> {
    try {
      this.logger.log(`Fetching Instagram profile data for: ${profile}`);

      // BrightData Instagram scraper API endpoint
      const endpoint = `/datasets/v3/scrape`;
      const datasetId = this.brightdataConfig.datasetId;

      // Request body structure as per BrightData API
      const requestBody = {
        input: [{ user_name: profile }],
      };

      // Query parameters
      const params = {
        dataset_id: datasetId,
        notify: "false",
        include_errors: "true",
        type: "discover_new",
        discover_by: "user_name",
      };

      const response = await this.httpClient.post<unknown>(
        endpoint,
        requestBody,
        {
          params,
        },
      );

      this.logger.log(`Successfully fetched data for profile: ${profile}`);

      // BrightData returns an array with profile data, extract the first item
      if (Array.isArray(response.data) && response.data.length > 0) {
        return response.data[0] as InstagramProfile;
      }

      // If it's a single object, return it directly
      if (response.data && typeof response.data === "object") {
        return response.data as InstagramProfile;
      }

      throw new Error(
        "Unexpected response format from BrightData API. Expected array with profile data or single profile object.",
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

        throw new Error("No response from Instagram scraper API");
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
      this.logger.log("Processing profile data with OpenRouter LLM");

      // Check if profile is private or data is unsuitable
      if (profileData.is_private) {
        return {
          summary: "Profile is private. Cannot analyze private profiles.",
          qualityScore: 0,
          message: "Profile is private and cannot be analyzed.",
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
            "Insufficient data available for analysis. Profile may be new or have limited activity.",
          qualityScore: 0,
          message: "Data is not suitable for evaluation.",
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
          hashtags: this.extractHashtags((post.caption as string) || ""),
        })),
      };

      // Create comprehensive prompt for LLM analysis
      const prompt = `Analyze this Instagram influencer profile data and provide a detailed analysis.

Profile Data:
- Account: ${analysisData.account || "Unknown"}
- Profile Name: ${analysisData.profile_name || "Unknown"}
- Followers: ${(analysisData.followers || 0).toLocaleString()}
- Posts Count: ${analysisData.posts_count || 0}
- Average Engagement Rate: ${((analysisData.avg_engagement || 0) * 100).toFixed(2)}%
- Biography: ${analysisData.biography || "No biography"}
- Verified: ${analysisData.is_verified ? "Yes" : "No"}
- Business Account: ${analysisData.is_business_account ? "Yes" : "No"}
- Professional Account: ${analysisData.is_professional_account ? "Yes" : "No"}

Recent Posts Sample:
${analysisData.posts
  .map(
    (post, idx) => `
Post ${idx + 1}:
- Caption: ${post.caption?.substring(0, 200) || "No caption"}
- Likes: ${(post.likes || 0).toLocaleString()}
- Comments: ${(post.comments || 0).toLocaleString()}
- Type: ${post.content_type || "Unknown"}
- Hashtags: ${post.hashtags?.join(", ") || "None"}`,
  )
  .join("\n")}

Please analyze this profile and provide a comprehensive analysis covering:

1. **Topic/Niche**: What is the influencer's main topic or niche?
2. **Sponsored Content**: Are they sponsored frequently? How often do you see sponsored content?
3. **Content Authenticity**: Is the content authentic or does it seem AI-generated/artificial?
4. **Follower Authenticity**: Are their followers likely real or do you see signs of fake/bought followers?
5. **Visible Brands**: What brands are visible in their content or collaborations?
6. **Engagement Strength**: How strong is the engagement? Is it consistent and genuine?
7. **Posts Analysis**: Analyze the posting patterns, content quality, and consistency
8. **Hashtags Statistics**: What hashtags do they use most? Are they relevant to their niche?

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
  "postsAnalysis": "<detailed analysis of posts>",
  "hashtagsStatistics": "<analysis of hashtag usage>"
}

Quality Score Guidelines:
- 1: Very poor quality, likely fake, low engagement, spam-like content
- 2: Poor quality, suspicious activity, low authenticity
- 3: Average quality, some concerns but generally acceptable
- 4: Good quality, authentic content, strong engagement
- 5: Excellent quality, highly authentic, strong engagement, established presence

Return ONLY the JSON object, no additional text or markdown formatting.`;

      const response = await this.llmClient.invoke([new HumanMessage(prompt)]);

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
          analysis.summary = "Analysis completed but summary not provided.";
        }
        if (!analysis.qualityScore) {
          analysis.qualityScore = 3;
        }
      } catch (parseError) {
        this.logger.warn(
          "Failed to parse LLM response as JSON, using fallback analysis",
          parseError,
        );

        // Fallback: create basic analysis
        const engagementOk = profileData.avg_engagement >= 0.01;
        const postsOk = profileData.posts_count >= 10;
        const qualityScore = engagementOk && postsOk ? 3 : 2;

        analysis = {
          summary: `Profile analysis for ${analysisData.account || "Unknown"}. ${(analysisData.followers || 0).toLocaleString()} followers, ${analysisData.posts_count || 0} posts, ${((analysisData.avg_engagement || 0) * 100).toFixed(2)}% average engagement rate.`,
          qualityScore,
          topic: "Unable to determine from available data",
          engagementStrength: engagementOk ? "moderate" : "weak",
          message: "LLM response parsing failed, using basic analysis.",
        };
      }

      return analysis;
    } catch (error) {
      this.logger.error("Error processing profile with LLM:", error);
      this.sentry.sendException(error);

      // Fallback analysis if LLM fails
      const engagementOk = profileData.avg_engagement >= 0.01;
      const postsOk = profileData.posts_count >= 10;
      const qualityScore = engagementOk && postsOk ? 3 : 2;

      return {
        summary: `Basic analysis for ${profileData.account || "Unknown"}. Profile has ${(profileData.followers || 0).toLocaleString()} followers and ${profileData.posts_count || 0} posts.`,
        qualityScore,
        engagementStrength: engagementOk ? "moderate" : "weak",
        message: "LLM analysis failed, using fallback analysis.",
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
}
