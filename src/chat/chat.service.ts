import { Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { OpenrouterConfigService } from '@libs/config';
import { ChatMessage, ChatMessageRole, TaskStatus } from '@libs/entities';
import { SentryClientService } from '@libs/sentry';
import {
  ChatMessagesRepository,
  ChatTasksRepository,
} from '@libs/repositories';

import { InstagramService } from '../instagram';
import { MetricsService } from '../metrics';
import { TasksService } from '../tasks';
import { TikTokService } from '../tiktok';
import { ChatDTO } from './dto';
import { ChatResponse } from './interfaces';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly defaultModel = 'google/gemini-2.5-flash';
  private readonly llmClient: ChatOpenAI | null;
  private readonly processingMessageContent = 'Processing your request...';

  constructor(
    private readonly openrouterConfig: OpenrouterConfigService,
    private readonly sentry: SentryClientService,
    private readonly metricsService: MetricsService,
    private readonly chatMessagesRepo: ChatMessagesRepository,
    private readonly chatTasksRepo: ChatTasksRepository,
    private readonly instagramService: InstagramService,
    private readonly tiktokService: TikTokService,
    private readonly tasksService: TasksService,
  ) {
    const apiKey = this.openrouterConfig.apiKey;
    if (apiKey) {
      this.llmClient = new ChatOpenAI({
        openAIApiKey: apiKey,
        modelName: this.defaultModel,
        configuration: {
          baseURL: this.openrouterConfig.baseUrl,
          defaultHeaders: {
            'HTTP-Referer': 'https://wykra-api.com',
            'X-Title': 'Wykra API - Chat',
          },
        },
        temperature: 0.7,
        timeout: this.openrouterConfig.timeout,
      });
    } else {
      this.llmClient = null;
      this.logger.warn(
        'OpenRouter API key not configured. Chat features will be unavailable.',
      );
    }
  }

  private ensureLLMClient(): ChatOpenAI {
    if (!this.llmClient) {
      throw new Error('OpenRouter API key not configured');
    }
    return this.llmClient;
  }

  /**
   * Extracts detected endpoint from LLM response
   */
  private extractDetectedEndpoint(content: string): string | undefined {
    const fullPathMatch = content.match(
      /\[DETECTED_ENDPOINT:\s*(\/(?:instagram\/(?:search|analysis)|tiktok\/(?:search|profile)))\s*\]/i,
    );
    if (fullPathMatch) {
      return fullPathMatch[1].toLowerCase();
    }

    const jsonMatch = content.match(
      /\{[\s\S]*"detectedEndpoint":\s*"(\/(?:instagram\/(?:search|analysis)|tiktok\/(?:search|profile)))"[\s\S]*\}/,
    );
    if (jsonMatch) {
      try {
        const json = JSON.parse(jsonMatch[0]) as {
          detectedEndpoint?: string;
        };
        if (
          json.detectedEndpoint &&
          /^\/(?:instagram\/(?:search|analysis)|tiktok\/(?:search|profile))$/.test(
            json.detectedEndpoint,
          )
        ) {
          return json.detectedEndpoint.toLowerCase();
        }
      } catch {
        // If JSON parsing fails, try regex extraction
        const endpointMatch = jsonMatch[0].match(
          /"detectedEndpoint":\s*"(\/(?:instagram\/(?:search|analysis)|tiktok\/(?:search|profile)))"/,
        );
        if (endpointMatch) {
          return endpointMatch[1].toLowerCase();
        }
      }
    }

    const platformMatch = content.match(
      /\[DETECTED_ENDPOINT:\s*(instagram|tiktok)\]/i,
    );
    if (platformMatch) {
      const platform = platformMatch[1].toLowerCase();
      const isSearchQuery =
        /\b(search|find|look|discover)\b/i.test(content) ||
        /\b(profiles?|accounts?|users?)\b/i.test(content);
      return isSearchQuery ? `/${platform}/search` : `/${platform}/profile`;
    }

    return undefined;
  }

  /**
   * Gets chat history for a user
   */
  public async getHistory(userId: number): Promise<ChatMessage[]> {
    return await this.chatMessagesRepo.findByUserId(userId);
  }

  /**
   * Extracts parameters for an endpoint from user query using LLM
   */
  private async extractEndpointParameters(
    endpoint: string,
    userQuery: string,
  ): Promise<{ query?: string; profile?: string } | null> {
    const llmClient = this.ensureLLMClient();

    let prompt = '';
    if (endpoint.includes('/search')) {
      prompt = `Extract the search query from the user's request. The user wants to search for profiles.

User request: "${userQuery}"

Extract the search query that describes what profiles to find. For example:
- "Find Instagram accounts from Portugal who post about cooking" -> query: "Find Instagram accounts from Portugal who post about cooking"
- "Search for TikTok creators in fashion" -> query: "Search for TikTok creators in fashion"

Respond with ONLY a JSON object in this format:
{"query": "the extracted search query"}

If you cannot extract a clear search query, respond with:
{"missing": "query"}`;
    } else if (
      endpoint.includes('/profile') ||
      endpoint.includes('/analysis')
    ) {
      prompt = `Extract the profile username from the user's request. The user wants to analyze a specific profile.

User request: "${userQuery}"

Extract the profile username/account name. For example:
- "Analyze @username" -> profile: "username"
- "Check the profile username123" -> profile: "username123"
- "Look at this account: test_user" -> profile: "test_user"

Respond with ONLY a JSON object in this format:
{"profile": "the extracted username"}

If you cannot extract a clear profile username, respond with:
{"missing": "profile"}`;
    } else {
      return null;
    }

    try {
      const response = await llmClient.invoke([new HumanMessage(prompt)]);
      const content = response.content as string;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          query?: string;
          profile?: string;
          missing?: string;
        };
        if (parsed.missing) {
          return null;
        }
        return parsed;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to extract parameters: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return null;
  }

  /**
   * Calls an endpoint and creates a chat task
   */
  private async callEndpoint(
    endpoint: string,
    params: { query?: string; profile?: string },
    userId: number,
    chatMessageId: number | null,
  ): Promise<string | null> {
    try {
      let taskId: string | null = null;

      if (endpoint === '/instagram/search' && params.query) {
        taskId = await this.instagramService.search(params.query);
      } else if (endpoint === '/instagram/analysis' && params.profile) {
        taskId = await this.instagramService.profile(params.profile);
      } else if (endpoint === '/tiktok/search' && params.query) {
        taskId = await this.tiktokService.search(params.query);
      } else if (endpoint === '/tiktok/profile' && params.profile) {
        taskId = await this.tiktokService.profile(params.profile);
      }

      if (taskId) {
        await this.chatTasksRepo.create({
          userId,
          chatMessageId: chatMessageId || null,
          taskId,
          endpoint,
          status: 'pending',
        });
        this.logger.log(`Created chat task ${taskId} for endpoint ${endpoint}`);
      }

      return taskId;
    } catch (error) {
      this.logger.error(
        `Failed to call endpoint ${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Polls task status and returns result when completed
   */
  private async pollTaskStatus(taskId: string): Promise<{
    status: string;
    result?: unknown;
    error?: string;
  }> {
    const maxAttempts = 60;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const { task } = await this.tasksService.getTaskStatus(taskId);
        if (!task) {
          return { status: 'not_found' };
        }

        if (task.status === TaskStatus.Completed) {
          let result: unknown = null;
          if (task.result) {
            try {
              if (typeof task.result === 'string') {
                result = JSON.parse(task.result);
              } else {
                result = task.result;
              }
            } catch (parseError) {
              this.logger.warn(
                `Failed to parse task result for ${taskId}: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
              );
              result = task.result;
            }
          }
          return { status: 'completed', result };
        }

        if (task.status === TaskStatus.Failed) {
          return { status: 'failed', error: task.error || 'Task failed' };
        }

        await new Promise((resolve) => setTimeout(resolve, 5000));
        attempts++;
      } catch (error) {
        this.logger.warn(
          `Error polling task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    return { status: 'timeout' };
  }

  /**
   * Handles user chat queries as an AI assistant
   */
  public async chat(dto: ChatDTO, userId: number): Promise<ChatResponse> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Processing chat query: ${dto.query.substring(0, 50)}...`,
      );

      const systemPrompt = `You are a helpful AI assistant for the Wykra API. 
You help users interact with social media analysis tools for Instagram and TikTok.

Available endpoints:
- /instagram/search - Search for Instagram profiles (POST, requires query parameter)
- /instagram/analysis - Analyze a specific Instagram profile (POST, requires profile parameter)
- /tiktok/search - Search for TikTok profiles (POST, requires query parameter)
- /tiktok/profile - Analyze a specific TikTok profile (POST, requires profile parameter)

IMPORTANT: At the end of your response, you MUST include endpoint detection information in this exact format:
[DETECTED_ENDPOINT: /instagram/search] or [DETECTED_ENDPOINT: /instagram/analysis] or [DETECTED_ENDPOINT: /tiktok/search] or [DETECTED_ENDPOINT: /tiktok/profile] or [DETECTED_ENDPOINT: none]

Detection rules:
- If the user wants to search/find/discover Instagram profiles, use [DETECTED_ENDPOINT: /instagram/search]
- If the user wants to analyze a specific Instagram profile/account, use [DETECTED_ENDPOINT: /instagram/analysis]
- If the user wants to search/find/discover TikTok profiles, use [DETECTED_ENDPOINT: /tiktok/search]
- If the user wants to analyze a specific TikTok profile/account, use [DETECTED_ENDPOINT: /tiktok/profile]
- If the query is not about Instagram or TikTok, use [DETECTED_ENDPOINT: none]

When users ask about Instagram or TikTok, be helpful and explain what they can do with these endpoints.
Provide clear, concise responses.`;

      const llmClient = this.ensureLLMClient();

      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(dto.query),
      ];

      const llmStartTime = Date.now();
      const model =
        this.openrouterConfig.model || this.defaultModel || 'unknown';
      const llmServiceLabel = 'chat_assistant';

      type LLMInvokeResponse = {
        content?: unknown;
        response_metadata?: {
          tokenUsage?: {
            promptTokens?: unknown;
            completionTokens?: unknown;
            totalTokens?: unknown;
          };
          usage?: {
            prompt_tokens?: unknown;
            completion_tokens?: unknown;
            total_tokens?: unknown;
          };
        };
        usage_metadata?: {
          input_tokens?: unknown;
          output_tokens?: unknown;
          total_tokens?: unknown;
        };
      };

      let response: LLMInvokeResponse;
      try {
        response = (await llmClient.invoke(messages)) as unknown as LLMInvokeResponse;
        const llmDuration = (Date.now() - llmStartTime) / 1000;

        // Always record the call + duration
        this.metricsService.recordLLMCall(model, llmServiceLabel);
        this.metricsService.recordLLMCallDuration(
          model,
          llmServiceLabel,
          llmDuration,
          'success',
        );

        // Extract usage from multiple possible locations
        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;

        // Check response_metadata.tokenUsage (camelCase - Anthropic format)
        if (response.response_metadata?.tokenUsage) {
          const tokenUsage = response.response_metadata.tokenUsage;
          promptTokens = Number(tokenUsage.promptTokens) || 0;
          completionTokens = Number(tokenUsage.completionTokens) || 0;
          totalTokens = Number(tokenUsage.totalTokens) || 0;
        }
        // Check usage_metadata (snake_case - LangChain format)
        else if (response.usage_metadata) {
          promptTokens = Number(response.usage_metadata.input_tokens) || 0;
          completionTokens = Number(response.usage_metadata.output_tokens) || 0;
          totalTokens = Number(response.usage_metadata.total_tokens) || 0;
        }
        // Fallback: check response_metadata.usage (snake_case - OpenAI format)
        else if (response.response_metadata?.usage) {
          const usage = response.response_metadata.usage;
          promptTokens = Number(usage.prompt_tokens) || 0;
          completionTokens = Number(usage.completion_tokens) || 0;
          totalTokens = Number(usage.total_tokens) || 0;
        }

        // Record token usage metrics (even if usage is missing → 0s)
        this.metricsService.recordLLMTokenUsage(
          model,
          llmServiceLabel,
          promptTokens,
          completionTokens,
          totalTokens,
        );
        this.metricsService.recordLLMTokensPerRequest(
          'chat',
          promptTokens,
          completionTokens,
        );
      } catch (error) {
        const llmDuration = (Date.now() - llmStartTime) / 1000;
        this.metricsService.recordLLMCall(model, llmServiceLabel);
        this.metricsService.recordLLMCallDuration(
          model,
          llmServiceLabel,
          llmDuration,
          'error',
        );
        this.metricsService.recordLLMError(model, llmServiceLabel, 'api_error');
        throw error;
      }
      const content =
        typeof response.content === 'string'
          ? response.content
          : String(response.content ?? '');

      const detectedEndpoint = this.extractDetectedEndpoint(content);

      const cleanContent = content
        .replace(
          /\[DETECTED_ENDPOINT:\s*(\/(?:instagram\/(?:search|analysis)|tiktok\/(?:search|profile))|none)\s*\]/gi,
          '',
        )
        .replace(
          /\{[\s\S]*"detectedEndpoint":\s*"(\/(?:instagram\/(?:search|analysis)|tiktok\/(?:search|profile))|none)"[\s\S]*\}/,
          '',
        )
        .replace(/\[DETECTED_ENDPOINT:\s*(instagram|tiktok|none)\]/gi, '')
        .trim();

      if (detectedEndpoint && detectedEndpoint !== 'none') {
        this.logger.log(`Detected endpoint call: ${detectedEndpoint}`);
      }

      try {
        await this.chatMessagesRepo.create({
          userId,
          role: ChatMessageRole.User,
          content: dto.query,
          detectedEndpoint: null,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to save user message: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (detectedEndpoint && detectedEndpoint !== 'none') {
        const params = await this.extractEndpointParameters(
          detectedEndpoint,
          dto.query,
        );

        const needsQuery = detectedEndpoint.endsWith('/search');
        const needsProfile =
          detectedEndpoint.endsWith('/analysis') ||
          detectedEndpoint.endsWith('/profile');

        if (
          !params ||
          (needsQuery && !params.query) ||
          (needsProfile && !params.profile)
        ) {
          const missingField = needsQuery ? 'query' : 'profile';
          const promptMessage = `I need more information to proceed. Please provide the ${missingField} for this request.`;
          try {
            await this.chatMessagesRepo.create({
              userId,
              role: ChatMessageRole.Assistant,
              content: promptMessage,
              detectedEndpoint,
            });
          } catch (error) {
            this.logger.warn(
              `Failed to save assistant prompt message: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          const duration = (Date.now() - startTime) / 1000;
          this.logger.log(`Chat response generated in ${duration}s`);
          return { response: promptMessage, detectedEndpoint };
        }

        let processingMessageId: number | null = null;
        try {
          const processingMsg = await this.chatMessagesRepo.create({
            userId,
            role: ChatMessageRole.Assistant,
            content: this.processingMessageContent,
            detectedEndpoint,
          });
          processingMessageId = processingMsg.id;
        } catch (error) {
          this.logger.warn(
            `Failed to save processing message: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        const taskId = await this.callEndpoint(
          detectedEndpoint,
          params,
          userId,
          processingMessageId,
        );

        if (!taskId) {
          const errorMessage =
            'Failed to start the requested task. Please try again.';
          if (processingMessageId) {
            try {
              await this.chatMessagesRepo.update(processingMessageId, {
                content: errorMessage,
                detectedEndpoint: null,
              });
            } catch (error) {
              this.logger.warn(
                `Failed to update processing message after task start failure: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          } else {
            try {
              await this.chatMessagesRepo.create({
                userId,
                role: ChatMessageRole.Assistant,
                content: errorMessage,
                detectedEndpoint: null,
              });
            } catch (error) {
              this.logger.warn(
                `Failed to save assistant error message: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }

          const duration = (Date.now() - startTime) / 1000;
          this.logger.log(`Chat response generated in ${duration}s`);
          return { response: errorMessage };
        }

        void this.handleTaskPolling(taskId, userId);

        const duration = (Date.now() - startTime) / 1000;
        this.logger.log(`Chat response generated in ${duration}s`);
        return { response: '', detectedEndpoint, taskId };
      } else {
        try {
          await this.chatMessagesRepo.create({
            userId,
            role: ChatMessageRole.Assistant,
            content: cleanContent,
            detectedEndpoint: null,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to save assistant message: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      this.logger.log(`Chat response generated in ${duration}s`);

      return { response: cleanContent };
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      this.logger.error(
        `Chat request failed after ${duration}s: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.sentry.sendException(error);
      throw error;
    }
  }

  /**
   * Detects platform from endpoint or result data
   */
  private detectPlatform(
    endpoint?: string | null,
    result?: unknown,
  ): 'instagram' | 'tiktok' | null {
    if (endpoint) {
      if (endpoint.includes('/instagram/')) {
        return 'instagram';
      }
      if (endpoint.includes('/tiktok/')) {
        return 'tiktok';
      }
    }

    if (result && typeof result === 'object') {
      const resultObj = result as Record<string, unknown>;
      const data = resultObj.data as Record<string, unknown> | undefined;

      if (data) {
        if (
          'videos_count' in data ||
          (typeof data.url === 'string' && data.url.includes('tiktok.com')) ||
          'profile_pic_url' in data ||
          'account_id' in data
        ) {
          return 'tiktok';
        }
        if (
          'posts_count' in data ||
          (typeof data.profile_url === 'string' &&
            data.profile_url.includes('instagram.com')) ||
          'profile_image_link' in data
        ) {
          return 'instagram';
        }
      }
    }

    return null;
  }

  /**
   * Handles task polling and sends results back to chat
   */
  private async handleTaskPolling(
    taskId: string,
    userId: number,
  ): Promise<void> {
    try {
      const chatTask = await this.chatTasksRepo.findByTaskId(taskId);
      const endpoint = chatTask?.endpoint;
      const chatMessageId = chatTask?.chatMessageId ?? null;

      await this.chatTasksRepo.update(taskId, { status: 'polling' });

      const taskResult = await this.pollTaskStatus(taskId);

      await this.chatTasksRepo.update(taskId, {
        status: taskResult.status,
      });

      let resultMessage = '';
      if (taskResult.status === 'completed' && taskResult.result) {
        const result = taskResult.result;

        const platform = this.detectPlatform(endpoint, result);

        if (typeof result === 'string') {
          try {
            const parsed = JSON.parse(result);
            if (
              parsed &&
              typeof parsed === 'object' &&
              'profile' in parsed &&
              'data' in parsed &&
              'analysis' in parsed
            ) {
              const marker =
                platform === 'tiktok'
                  ? '[TIKTOK_PROFILE_ANALYSIS]'
                  : '[INSTAGRAM_PROFILE_ANALYSIS]';
              resultMessage = `${marker}\n${JSON.stringify(parsed)}`;
            } else {
              resultMessage = `Task completed! Here are the results:\n\n${result}`;
            }
          } catch {
            resultMessage = `Task completed! Here are the results:\n\n${result}`;
          }
        } else if (
          result &&
          typeof result === 'object' &&
          'profile' in result &&
          'data' in result &&
          'analysis' in result
        ) {
          const profileData = result as {
            profile: string;
            data: Record<string, unknown>;
            analysis: Record<string, unknown>;
          };
          const marker =
            platform === 'tiktok'
              ? '[TIKTOK_PROFILE_ANALYSIS]'
              : '[INSTAGRAM_PROFILE_ANALYSIS]';
          resultMessage = `${marker}\n${JSON.stringify(profileData)}`;
        } else {
          resultMessage = `Task completed! Here are the results:\n\n${JSON.stringify(taskResult.result, null, 2)}`;
        }
      } else if (taskResult.status === 'failed') {
        resultMessage = `Task failed: ${taskResult.error || 'Unknown error'}`;
      } else if (taskResult.status === 'timeout') {
        resultMessage =
          'Task is taking longer than expected. You can check the status later using the task ID.';
      } else {
        resultMessage = `Task status: ${taskResult.status}`;
      }

      if (chatMessageId) {
        await this.chatMessagesRepo.update(chatMessageId, {
          content: resultMessage,
          detectedEndpoint: null,
        });
      } else {
        await this.chatMessagesRepo.create({
          userId,
          role: ChatMessageRole.Assistant,
          content: resultMessage,
          detectedEndpoint: null,
        });
      }
    } catch (error) {
      this.logger.error(
        `Error handling task polling for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
