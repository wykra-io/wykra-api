import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  BaseMessage,
} from '@langchain/core/messages';
import { Injectable, Logger } from '@nestjs/common';

import { OpenrouterConfigService } from '@libs/config';
import { SentryClientService } from '@libs/sentry';

import { MetricsService } from '../metrics';
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
  } | null;

  constructor(
    private readonly openrouterConfig: OpenrouterConfigService,
    private readonly sentry: SentryClientService,
    private readonly metricsService: MetricsService,
  ) {
    // Base configuration for creating ChatOpenAI instances
    if (this.openrouterConfig.isConfigured) {
      this.baseConfig = {
        openAIApiKey: this.openrouterConfig.apiKey!,
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
    } else {
      this.baseConfig = null;
      this.logger.warn(
        'OpenRouter API key not configured. Perplexity features will be unavailable.',
      );
    }
  }

  private ensureBaseConfig() {
    if (!this.baseConfig) {
      throw new Error(
        'OpenRouter API key is not configured. Please set OPENROUTER_API_KEY environment variable.',
      );
    }
    return this.baseConfig;
  }

  /**
   * Creates a ChatOpenAI instance for the specified model.
   */
  private createClient(model: string): ChatOpenAI {
    return new ChatOpenAI({
      ...this.ensureBaseConfig(),
      modelName: model,
    });
  }

  /**
   * Sends a chat message to Perplexity via OpenRouter.
   * Handles continue reasoning by checking finish_reason and continuing the conversation if needed.
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
      const messages: BaseMessage[] = [];

      if (dto.systemPrompt) {
        messages.push(new SystemMessage(dto.systemPrompt));
      }

      messages.push(new HumanMessage(dto.message));

      // Track total usage across multiple invocations
      const totalUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      const maxIterations = 5; // Prevent infinite loops
      let iteration = 0;
      let fullContent = '';
      const llmStartTime = Date.now();

      // Continue reasoning loop
      while (iteration < maxIterations) {
        iteration++;

        // Invoke the LLM
        const response = await llmClient.invoke(messages);
        console.log(`response (iteration ${iteration}): `, response);

        // Accumulate content
        const responseContent = response.content as string;
        fullContent += (fullContent ? '\n\n' : '') + responseContent;

        // Accumulate usage from multiple possible locations
        let iterationPromptTokens = 0;
        let iterationCompletionTokens = 0;
        let iterationTotalTokens = 0;

        // Check response_metadata.tokenUsage (camelCase - Anthropic format)
        if (response.response_metadata?.tokenUsage) {
          const tokenUsage = response.response_metadata.tokenUsage;
          iterationPromptTokens = Number(tokenUsage.promptTokens) || 0;
          iterationCompletionTokens = Number(tokenUsage.completionTokens) || 0;
          iterationTotalTokens = Number(tokenUsage.totalTokens) || 0;
        }
        // Check usage_metadata (snake_case - LangChain format)
        else if (response.usage_metadata) {
          iterationPromptTokens =
            Number(response.usage_metadata.input_tokens) || 0;
          iterationCompletionTokens =
            Number(response.usage_metadata.output_tokens) || 0;
          iterationTotalTokens =
            Number(response.usage_metadata.total_tokens) || 0;
        }
        // Fallback: check response_metadata.usage (snake_case - OpenAI format)
        else if (response.response_metadata?.usage) {
          const usage = response.response_metadata.usage;
          iterationPromptTokens = Number(usage.prompt_tokens) || 0;
          iterationCompletionTokens = Number(usage.completion_tokens) || 0;
          iterationTotalTokens = Number(usage.total_tokens) || 0;
        }

        totalUsage.promptTokens += iterationPromptTokens;
        totalUsage.completionTokens += iterationCompletionTokens;
        totalUsage.totalTokens += iterationTotalTokens;

        // Check finish reason to determine if we should continue
        const finishReason =
          response.response_metadata?.finish_reason ||
          response.response_metadata?.finishReason;

        this.logger.log(
          `Iteration ${iteration}: finish_reason = ${finishReason}`,
        );

        // If finish_reason is "stop" or null/undefined, we're done
        if (finishReason === 'stop' || !finishReason) {
          this.logger.log(`Response complete after ${iteration} iteration(s)`);
          break;
        }

        // If finish_reason is "tool_calls" but tool_calls is empty or we want to continue reasoning
        // Add the assistant's response to the conversation and continue
        if (
          finishReason === 'tool_calls' ||
          finishReason === 'length' ||
          finishReason === 'content_filter'
        ) {
          // Add assistant response to message history
          messages.push(new AIMessage(responseContent));

          // If it's tool_calls, we might want to add a follow-up message
          if (finishReason === 'tool_calls') {
            // Add a message to continue reasoning
            messages.push(
              new HumanMessage(
                'Please continue with your reasoning and complete your response.',
              ),
            );
          }

          this.logger.log(
            `Continuing reasoning (${finishReason}), iteration ${iteration}`,
          );
          continue;
        }

        // For any other finish reason, break
        break;
      }

      if (iteration >= maxIterations) {
        this.logger.warn(
          `Reached maximum iterations (${maxIterations}), returning partial response`,
        );
      }

      const llmDuration = (Date.now() - llmStartTime) / 1000;

      // Record token usage metrics (always record the call, even if usage is 0)
      this.metricsService.recordLLMCall(model, 'perplexity');
      this.metricsService.recordLLMCallDuration(
        model,
        'perplexity',
        llmDuration,
        'success',
      );

      if (totalUsage.totalTokens > 0) {
        this.metricsService.recordLLMTokenUsage(
          model,
          'perplexity',
          totalUsage.promptTokens,
          totalUsage.completionTokens,
          totalUsage.totalTokens,
        );
        this.metricsService.recordLLMTokensPerRequest(
          'search',
          totalUsage.promptTokens,
          totalUsage.completionTokens,
        );
      } else {
        // Record with 0 values if usage data is missing
        this.metricsService.recordLLMTokenUsage(model, 'perplexity', 0, 0, 0);
        this.metricsService.recordLLMTokensPerRequest('search', 0, 0);
      }

      this.logger.log(
        `Successfully received response from Perplexity (${model}) after ${iteration} iteration(s)`,
      );

      return {
        content: fullContent,
        model,
        usage: {
          promptTokens: totalUsage.promptTokens,
          completionTokens: totalUsage.completionTokens,
          totalTokens: totalUsage.totalTokens,
        },
      };
    } catch (error) {
      this.metricsService.recordLLMError(
        dto.model || this.defaultModel,
        'perplexity',
        'api_error',
      );

      this.logger.error('Error calling Perplexity via OpenRouter:', error);
      this.sentry.sendException(error, {
        message: dto.message,
        model: dto.model || this.defaultModel,
      });

      throw error;
    }
  }

  /**
   * Searches for micro-influencers on Instagram based on the provided query.
   *
   * @param {string} query - The search query describing what influencers to find.
   *
   * @returns {Promise<PerplexityChatResponse>} The response from Perplexity with influencer data in JSON format.
   */
  public async search(query: string): Promise<PerplexityChatResponse> {
    const prompt = `${query}. Prefer creators with high engagement and human-looking content. Provide the results in pure JSON format, containing a list of up to 15 objects with the following fields:

"name" – the influencer's name

"handle" – the Instagram handle

"topic" – the main content topic

"followers" – follower count

"engagement_note" – short note on engagement quality

"authenticity_score_guess" – estimated authenticity of content

Return only the JSON array, without any explanations or extra text.`;

    return this.chat({
      message: prompt,
    });
  }

  /**
   * Gets Instagram hashtags and then finds micro-influencers using those hashtags.
   * Makes two sequential Perplexity calls: first for hashtags, then for influencers.
   *
   * @param {string} query - The search query describing the topic/community to find hashtags for.
   *
   * @returns {Promise<PerplexityPromptChainResponse>} Combined response with hashtags and influencers.
   */
  public async searchChain(
    query: string,
  ): Promise<PerplexityPromptChainResponse> {
    try {
      this.logger.log('Starting searchChain: fetching hashtags...');

      // First call: Get hashtags
      const hashtagsPrompt = `Give me 10 Instagram hashtags used by ${query} in 2024–2025. Provide the results in pure JSON format, containing a list of up to 15 objects with the following fields:

"hashtag","short_rationale","popularity_note"

Return only the JSON array, without any explanations or extra text.`;

      const hashtagsResponse = await this.chat({
        message: hashtagsPrompt,
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
      this.logger.error('Error in searchChain:', error);
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
