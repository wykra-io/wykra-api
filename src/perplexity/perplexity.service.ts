import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Injectable, Logger } from '@nestjs/common';

import { OpenrouterConfigService } from '@libs/config';
import { SentryClientService } from '@libs/sentry';

import { PerplexityChatDTO } from './dto';
import {
  PerplexityChatResponse,
  PerplexityPromptChainResponse,
  HashtagData,
  InfluencerData,
} from './interfaces';

@Injectable()
export class PerplexityService {
  private readonly logger = new Logger(PerplexityService.name);
  private readonly defaultModel = 'perplexity/sonar-pro-search';
  private readonly baseConfig: {
    openAIApiKey: string;
    configuration: {
      baseURL: string;
      defaultHeaders: Record<string, string>;
    };
    temperature: number;
    timeout: number;
  };

  constructor(
    private readonly openrouterConfig: OpenrouterConfigService,
    private readonly sentry: SentryClientService,
  ) {
    // Base configuration for creating ChatOpenAI instances
    this.baseConfig = {
      openAIApiKey: this.openrouterConfig.apiKey,
      configuration: {
        baseURL: this.openrouterConfig.baseUrl,
        defaultHeaders: {
          'HTTP-Referer': 'https://wykra-api.com',
          'X-Title': 'Wykra API - Perplexity',
        },
      },
      temperature: 0.7,
      timeout: this.openrouterConfig.timeout,
    };
  }

  /**
   * Creates a ChatOpenAI instance for the specified model.
   */
  private createClient(model: string): ChatOpenAI {
    return new ChatOpenAI({
      ...this.baseConfig,
      modelName: model,
    });
  }

  /**
   * Sends a chat message to Perplexity via OpenRouter.
   *
   * @param {PerplexityChatDTO} dto - The chat request containing message and optional parameters.
   *
   * @returns {Promise<PerplexityChatResponse>} The response from Perplexity.
   */
  public async chat(dto: PerplexityChatDTO): Promise<PerplexityChatResponse> {
    try {
      this.logger.log(
        `Processing Perplexity chat request: ${dto.message.substring(0, 50)}...`,
      );

      const model = dto.model || this.defaultModel;

      // Create client for the specified model
      const llmClient = this.createClient(model);

      // Prepare messages
      const messages: (SystemMessage | HumanMessage)[] = [];

      if (dto.systemPrompt) {
        messages.push(new SystemMessage(dto.systemPrompt));
      }

      messages.push(new HumanMessage(dto.message));

      // Invoke the LLM
      const response = await llmClient.invoke(messages);

      // Extract usage information if available
      const usage = response.response_metadata?.usage
        ? {
            promptTokens: response.response_metadata.usage.prompt_tokens,
            completionTokens:
              response.response_metadata.usage.completion_tokens,
            totalTokens: response.response_metadata.usage.total_tokens,
          }
        : undefined;

      this.logger.log(
        `Successfully received response from Perplexity (${model})`,
      );

      return {
        content: response.content as string,
        model,
        usage,
      };
    } catch (error) {
      this.logger.error('Error calling Perplexity via OpenRouter:', error);
      this.sentry.sendException(error, {
        message: dto.message,
        model: dto.model || this.defaultModel,
      });

      throw error;
    }
  }

  /**
   * Finds micro-influencers on Instagram who post about tech gadgets and AI tools.
   *
   * @param {string} model - Optional Perplexity model to use. Defaults to the service default.
   *
   * @returns {Promise<PerplexityChatResponse>} The response from Perplexity with influencer data in JSON format.
   */
  public async findAsDiscoveryEngine(
    model?: string,
  ): Promise<PerplexityChatResponse> {
    const prompt = `Give me a list of 10 micro-influencers (5K–50K followers) on Instagram who post about tech gadgets and AI tools. Prefer creators with high engagement and human-looking content. Provide the results in pure JSON format, containing a list of up to 15 objects with the following fields:

"name" – the influencer's name

"handle" – the Instagram handle

"topic" – the main content topic

"followers" – follower count

"engagement_note" – short note on engagement quality

"authenticity_score_guess" – estimated authenticity of content

Return only the JSON array, without any explanations or extra text.`;

    return this.chat({
      message: prompt,
      model,
    });
  }

  /**
   * Gets Instagram hashtags and then finds micro-influencers using those hashtags.
   * Makes two sequential Perplexity calls: first for hashtags, then for influencers.
   *
   * @param {string} model - Optional Perplexity model to use. Defaults to the service default.
   *
   * @returns {Promise<PerplexityPromptChainResponse>} Combined response with hashtags and influencers.
   */
  public async promptChain(
    model?: string,
  ): Promise<PerplexityPromptChainResponse> {
    try {
      this.logger.log('Starting promptChain: fetching hashtags...');

      // First call: Get hashtags
      const hashtagsPrompt = `Give me 10 Instagram hashtags used by indie makers and AI builders in 2024–2025. Provide the results in pure JSON format, containing a list of up to 15 objects with the following fields:

"hashtag","short_rationale","popularity_note"

Return only the JSON array, without any explanations or extra text.`;

      const hashtagsResponse = await this.chat({
        message: hashtagsPrompt,
        model,
      });

      console.log('hashtagsResponse: ', hashtagsResponse.content);

      // Parse hashtags from the first response
      let hashtags: HashtagData[] = [];
      try {
        // Extract JSON from response content (handle potential markdown formatting)
        const jsonMatch = hashtagsResponse.content.match(/\[[\s\S]*\]/);
        const jsonString = jsonMatch ? jsonMatch[0] : hashtagsResponse.content;
        hashtags = JSON.parse(jsonString) as HashtagData[];

        if (!Array.isArray(hashtags)) {
          throw new Error('Hashtags response is not an array');
        }

        this.logger.log(`Successfully parsed ${hashtags.length} hashtags`);
      } catch (parseError) {
        this.logger.error('Failed to parse hashtags JSON:', parseError);
        this.sentry.sendException(parseError, {
          content: hashtagsResponse.content,
        });
        throw new Error('Failed to parse hashtags from first response');
      }

      // Extract hashtag strings for the second prompt
      const hashtagStrings = hashtags.map((h) => h.hashtag);

      // Second call: Find influencers using the hashtags
      this.logger.log(
        `Finding influencers using hashtags: ${hashtagStrings.slice(0, 5).join(', ')}...`,
      );

      const influencersPrompt = `Using the following hashtags: ${JSON.stringify(hashtagStrings)}, 
give me a list of 10 micro-influencers (5K–50K followers) on Instagram who post about tech gadgets, AI tools, or indie maker projects. Prefer creators with high engagement and human-looking content. Provide the results in pure JSON format, containing a list of up to 15 objects with fields:

"name", "handle", "topic", "followers", "engagement_note", "authenticity_score_guess".

Return only the JSON array.`;

      const influencersResponse = await this.chat({
        message: influencersPrompt,
        model,
      });

      // Parse influencers from the second response
      let influencers: InfluencerData[] = [];
      try {
        // Extract JSON from response content
        const jsonMatch = influencersResponse.content.match(/\[[\s\S]*\]/);
        const jsonString = jsonMatch
          ? jsonMatch[0]
          : influencersResponse.content;
        influencers = JSON.parse(jsonString) as InfluencerData[];

        if (!Array.isArray(influencers)) {
          throw new Error('Influencers response is not an array');
        }

        this.logger.log(
          `Successfully parsed ${influencers.length} influencers`,
        );
      } catch (parseError) {
        this.logger.error('Failed to parse influencers JSON:', parseError);
        this.sentry.sendException(parseError, {
          content: influencersResponse.content,
        });
        throw new Error('Failed to parse influencers from second response');
      }

      return {
        hashtags,
        influencers,
        hashtagsResponse,
        influencersResponse,
      };
    } catch (error) {
      this.logger.error('Error in promptChain:', error);
      this.sentry.sendException(error);
      throw error;
    }
  }

  /**
   * Gets available Perplexity models on OpenRouter.
   * Note: This is a static list. For dynamic model discovery, you'd need to call OpenRouter's API.
   *
   * @returns {string[]} Array of available Perplexity model identifiers.
   */
  public getAvailableModels(): string[] {
    return ['perplexity/sonar-pro-search'];
  }
}
