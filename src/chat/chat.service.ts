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

type ChatEndpoint = '/instagram/analysis' | '/tiktok/profile';

type EndpointParams = { query?: string; profile?: string };

const DETECTED_ENDPOINT_FULLPATH_RE =
  /\[DETECTED_ENDPOINT:\s*(\/(?:instagram\/analysis|tiktok\/profile))\s*\]/i;
const DETECTED_ENDPOINT_JSON_RE =
  /\{[\s\S]*"detectedEndpoint":\s*"(\/(?:instagram\/analysis|tiktok\/profile))"[\s\S]*\}/;
const DETECTED_ENDPOINT_ALLOWED_RE =
  /^\/(?:instagram\/analysis|tiktok\/profile)$/;

const STRIP_DETECTED_ENDPOINT_MARKER_RE =
  /\[DETECTED_ENDPOINT:\s*(\/(?:instagram\/analysis|tiktok\/profile)|none)\s*\]/gi;
const STRIP_DETECTED_ENDPOINT_JSON_RE =
  /\{[\s\S]*"detectedEndpoint":\s*"(\/(?:instagram\/analysis|tiktok\/profile)|none)"[\s\S]*\}/;
const STRIP_DETECTED_ENDPOINT_PLATFORM_MARKER_RE =
  /\[DETECTED_ENDPOINT:\s*(instagram|tiktok|none)\]/gi;

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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getModelLabel(): string {
    return this.openrouterConfig.model || this.defaultModel || 'unknown';
  }

  private buildSystemPrompt(): string {
    return `You are a helpful AI assistant for the Wykra API. 
You help users interact with social media analysis tools for Instagram and TikTok.

Available endpoints:
- /instagram/analysis - Analyze a specific Instagram profile (POST, requires profile parameter)
- /tiktok/profile - Analyze a specific TikTok profile (POST, requires profile parameter)

IMPORTANT: At the end of your response, you MUST include endpoint detection information in this exact format:
[DETECTED_ENDPOINT: /instagram/analysis] or [DETECTED_ENDPOINT: /tiktok/profile] or [DETECTED_ENDPOINT: none]

Detection rules:
- If the user wants to analyze a specific Instagram profile/account, use [DETECTED_ENDPOINT: /instagram/analysis]
- If the user wants to analyze a specific TikTok profile/account, use [DETECTED_ENDPOINT: /tiktok/profile]
- If the query is not about Instagram or TikTok, use [DETECTED_ENDPOINT: none]

When users ask about Instagram or TikTok, be helpful and explain what they can do with these endpoints.
Provide clear, concise responses.`;
  }

  private normalizeLLMContent(content: unknown): string {
    if (content === null || content === undefined) {
      return '';
    }

    switch (typeof content) {
      case 'string':
        return content;
      case 'number':
      case 'boolean':
      case 'bigint':
        return String(content);
      case 'symbol':
        return content.description ?? '';
      case 'function':
        return '';
      case 'object':
        try {
          return JSON.stringify(content);
        } catch {
          return '';
        }
      default:
        return '';
    }
  }

  private extractChatAssistantTokenUsage(response: {
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
  }): { promptTokens: number; completionTokens: number; totalTokens: number } {
    // Check response_metadata.tokenUsage (camelCase - Anthropic format)
    if (response.response_metadata?.tokenUsage) {
      const tokenUsage = response.response_metadata.tokenUsage;
      return {
        promptTokens: Number(tokenUsage.promptTokens) || 0,
        completionTokens: Number(tokenUsage.completionTokens) || 0,
        totalTokens: Number(tokenUsage.totalTokens) || 0,
      };
    }

    // Check usage_metadata (snake_case - LangChain format)
    if (response.usage_metadata) {
      return {
        promptTokens: Number(response.usage_metadata.input_tokens) || 0,
        completionTokens: Number(response.usage_metadata.output_tokens) || 0,
        totalTokens: Number(response.usage_metadata.total_tokens) || 0,
      };
    }

    // Fallback: check response_metadata.usage (snake_case - OpenAI format)
    if (response.response_metadata?.usage) {
      const usage = response.response_metadata.usage;
      return {
        promptTokens: Number(usage.prompt_tokens) || 0,
        completionTokens: Number(usage.completion_tokens) || 0,
        totalTokens: Number(usage.total_tokens) || 0,
      };
    }

    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }

  private async invokeChatAssistant(
    userQuery: string,
  ): Promise<{ content: string }> {
    const llmClient = this.ensureLLMClient();
    const model = this.getModelLabel();
    const llmServiceLabel = 'chat_assistant';
    const llmStartTime = Date.now();

    const messages = [
      new SystemMessage(this.buildSystemPrompt()),
      new HumanMessage(userQuery),
    ];

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

    try {
      const response = (await llmClient.invoke(
        messages,
      )) as unknown as LLMInvokeResponse;
      const llmDuration = (Date.now() - llmStartTime) / 1000;

      // Always record the call + duration
      this.metricsService.recordLLMCall(model, llmServiceLabel);
      this.metricsService.recordLLMCallDuration(
        model,
        llmServiceLabel,
        llmDuration,
        'success',
      );

      const { promptTokens, completionTokens, totalTokens } =
        this.extractChatAssistantTokenUsage(response);

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

      return { content: this.normalizeLLMContent(response.content) };
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
  }

  private cleanAssistantContent(content: string): string {
    return content
      .replace(STRIP_DETECTED_ENDPOINT_MARKER_RE, '')
      .replace(STRIP_DETECTED_ENDPOINT_JSON_RE, '')
      .replace(STRIP_DETECTED_ENDPOINT_PLATFORM_MARKER_RE, '')
      .trim();
  }

  private async safeCreateMessage(params: {
    userId: number;
    role: ChatMessageRole;
    content: string;
    detectedEndpoint: string | null;
  }): Promise<{ id: number } | null> {
    try {
      const created = await this.chatMessagesRepo.create(params);
      return { id: created.id };
    } catch (error) {
      this.logger.warn(
        `Failed to save message: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async safeUpdateMessage(
    messageId: number,
    patch: { content?: string; detectedEndpoint?: string | null },
    context: string,
  ): Promise<void> {
    try {
      await this.chatMessagesRepo.update(messageId, patch);
    } catch (error) {
      this.logger.warn(
        `Failed to update message (${context}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private getRequiredParamForEndpoint(): 'profile' {
    // Search endpoints are disabled/removed from chat; only analysis/profile endpoints remain.
    return 'profile';
  }

  /**
   * Extracts detected endpoint from LLM response
   */
  private extractDetectedEndpoint(content: string): ChatEndpoint | undefined {
    const fullPathMatch = content.match(DETECTED_ENDPOINT_FULLPATH_RE);
    if (fullPathMatch) {
      const candidate = fullPathMatch[1].toLowerCase();
      if (DETECTED_ENDPOINT_ALLOWED_RE.test(candidate)) {
        return candidate as ChatEndpoint;
      }
    }

    const jsonMatch = content.match(DETECTED_ENDPOINT_JSON_RE);
    if (jsonMatch) {
      try {
        const json = JSON.parse(jsonMatch[0]) as {
          detectedEndpoint?: string;
        };
        if (
          json.detectedEndpoint &&
          DETECTED_ENDPOINT_ALLOWED_RE.test(json.detectedEndpoint)
        ) {
          return json.detectedEndpoint.toLowerCase() as ChatEndpoint;
        }
      } catch {
        // If JSON parsing fails, try regex extraction
        const endpointMatch = jsonMatch[0].match(
          /"detectedEndpoint":\s*"(\/(?:instagram\/analysis|tiktok\/profile))"/,
        );
        if (endpointMatch) {
          const candidate = endpointMatch[1].toLowerCase();
          if (DETECTED_ENDPOINT_ALLOWED_RE.test(candidate)) {
            return candidate as ChatEndpoint;
          }
        }
      }
    }

    const platformMatch = content.match(
      /\[DETECTED_ENDPOINT:\s*(instagram|tiktok)\]/i,
    );
    if (platformMatch) {
      const platform = platformMatch[1].toLowerCase() as 'instagram' | 'tiktok';
      const candidate =
        platform === 'instagram'
          ? ('/instagram/analysis' as const)
          : ('/tiktok/profile' as const);
      if (DETECTED_ENDPOINT_ALLOWED_RE.test(candidate)) {
        return candidate as ChatEndpoint;
      }
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
    endpoint: ChatEndpoint,
    userQuery: string,
  ): Promise<EndpointParams | null> {
    const llmClient = this.ensureLLMClient();

    let prompt = '';
    if (endpoint.includes('/profile') || endpoint.includes('/analysis')) {
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
    endpoint: ChatEndpoint,
    params: EndpointParams,
    userId: number,
    chatMessageId: number | null,
  ): Promise<string | null> {
    try {
      const endpointCallMap: Record<
        ChatEndpoint,
        (p: EndpointParams) => Promise<string>
      > = {
        '/instagram/analysis': async (p) =>
          await this.instagramService.profile(p.profile as string),
        '/tiktok/profile': async (p) =>
          await this.tiktokService.profile(p.profile as string),
      };

      const required = this.getRequiredParamForEndpoint();
      if (!params[required]) {
        return null;
      }

      const taskId = await endpointCallMap[endpoint](params);

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

        await this.sleep(5000);
        attempts++;
      } catch (error) {
        this.logger.warn(
          `Error polling task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        attempts++;
        await this.sleep(5000);
      }
    }

    return { status: 'timeout' };
  }

  private async handleDetectedEndpointFlow(params: {
    detectedEndpoint: ChatEndpoint;
    userQuery: string;
    userId: number;
    startTime: number;
  }): Promise<ChatResponse> {
    const { detectedEndpoint, userQuery, userId, startTime } = params;
    this.logger.log(`Detected endpoint call: ${detectedEndpoint}`);

    const extractedParams = await this.extractEndpointParameters(
      detectedEndpoint,
      userQuery,
    );

    const required = this.getRequiredParamForEndpoint();
    if (!extractedParams || !extractedParams[required]) {
      const promptMessage = `I need more information to proceed. Please provide the ${required} for this request.`;
      await this.safeCreateMessage({
        userId,
        role: ChatMessageRole.Assistant,
        content: promptMessage,
        detectedEndpoint,
      });

      const duration = (Date.now() - startTime) / 1000;
      this.logger.log(`Chat response generated in ${duration}s`);
      return { response: promptMessage, detectedEndpoint };
    }

    const processingMsg = await this.safeCreateMessage({
      userId,
      role: ChatMessageRole.Assistant,
      content: this.processingMessageContent,
      detectedEndpoint,
    });
    const processingMessageId = processingMsg?.id ?? null;

    const taskId = await this.callEndpoint(
      detectedEndpoint,
      extractedParams,
      userId,
      processingMessageId,
    );

    if (!taskId) {
      const errorMessage =
        'Failed to start the requested task. Please try again.';
      if (processingMessageId) {
        await this.safeUpdateMessage(
          processingMessageId,
          { content: errorMessage, detectedEndpoint: null },
          'task start failure',
        );
      } else {
        await this.safeCreateMessage({
          userId,
          role: ChatMessageRole.Assistant,
          content: errorMessage,
          detectedEndpoint: null,
        });
      }

      const duration = (Date.now() - startTime) / 1000;
      this.logger.log(`Chat response generated in ${duration}s`);
      return { response: errorMessage };
    }

    void this.handleTaskPolling(taskId, userId);

    const duration = (Date.now() - startTime) / 1000;
    this.logger.log(`Chat response generated in ${duration}s`);
    return { response: '', detectedEndpoint, taskId };
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

      const { content: rawContent } = await this.invokeChatAssistant(dto.query);
      const detectedEndpoint = this.extractDetectedEndpoint(rawContent);
      const cleanContent = this.cleanAssistantContent(rawContent);

      await this.safeCreateMessage({
        userId,
        role: ChatMessageRole.User,
        content: dto.query,
        detectedEndpoint: null,
      });

      if (detectedEndpoint) {
        return await this.handleDetectedEndpointFlow({
          detectedEndpoint,
          userQuery: dto.query,
          userId,
          startTime,
        });
      }

      await this.safeCreateMessage({
        userId,
        role: ChatMessageRole.Assistant,
        content: cleanContent,
        detectedEndpoint: null,
      });

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

  private isProfileAnalysisResult(value: unknown): value is {
    profile: string;
    data: Record<string, unknown>;
    analysis: Record<string, unknown>;
  } {
    return (
      !!value &&
      typeof value === 'object' &&
      'profile' in value &&
      'data' in value &&
      'analysis' in value
    );
  }

  private getProfileAnalysisMarker(
    platform: 'instagram' | 'tiktok' | null,
  ): string {
    return platform === 'tiktok'
      ? '[TIKTOK_PROFILE_ANALYSIS]'
      : '[INSTAGRAM_PROFILE_ANALYSIS]';
  }

  private formatTaskResultMessage(params: {
    status: string;
    result?: unknown;
    error?: string;
    endpoint?: string | null;
  }): string {
    const { status, result, error, endpoint } = params;

    if (status === 'completed' && result) {
      const platform = this.detectPlatform(endpoint, result);

      if (typeof result === 'string') {
        try {
          const parsed = JSON.parse(result) as unknown;
          if (this.isProfileAnalysisResult(parsed)) {
            const marker = this.getProfileAnalysisMarker(platform);
            return `${marker}\n${JSON.stringify(parsed)}`;
          }
          return `Task completed! Here are the results:\n\n${result}`;
        } catch {
          return `Task completed! Here are the results:\n\n${result}`;
        }
      }

      if (this.isProfileAnalysisResult(result)) {
        const marker = this.getProfileAnalysisMarker(platform);
        return `${marker}\n${JSON.stringify(result)}`;
      }

      return `Task completed! Here are the results:\n\n${JSON.stringify(result, null, 2)}`;
    }

    if (status === 'failed') {
      return `Task failed: ${error || 'Unknown error'}`;
    }

    if (status === 'timeout') {
      return 'Task is taking longer than expected. You can check the status later using the task ID.';
    }

    return `Task status: ${status}`;
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

      try {
        await this.chatTasksRepo.update(taskId, { status: 'polling' });
      } catch (error) {
        this.logger.warn(
          `Failed to update chat task ${taskId} to polling: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const taskResult = await this.pollTaskStatus(taskId);

      try {
        await this.chatTasksRepo.update(taskId, {
          status: taskResult.status,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to update chat task ${taskId} status to ${taskResult.status}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const resultMessage = this.formatTaskResultMessage({
        status: taskResult.status,
        result: taskResult.result,
        error: taskResult.error,
        endpoint,
      });

      if (chatMessageId) {
        await this.safeUpdateMessage(
          chatMessageId,
          { content: resultMessage, detectedEndpoint: null },
          'task polling result update',
        );
      } else {
        await this.safeCreateMessage({
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
