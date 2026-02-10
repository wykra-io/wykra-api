import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';

import { OpenrouterConfigService } from '@libs/config';
import {
  ChatMessage,
  ChatMessageRole,
  ChatSession,
  TaskStatus,
} from '@libs/entities';
import { SentryClientService } from '@libs/sentry';
import {
  ChatMessagesRepository,
  ChatTasksRepository,
  ChatSessionsRepository,
} from '@libs/repositories';

import { InstagramService } from '../instagram';
import { MetricsService } from '../metrics';
import { TasksService } from '../tasks';
import { TikTokService } from '../tiktok';
import { ChatDTO } from './dto';
import { ChatResponse } from './interfaces';

type ChatEndpoint =
  | '/instagram/analysis'
  | '/instagram/search'
  | '/tiktok/profile'
  | '/tiktok/search';

type EndpointParams = { query?: string; profile?: string };

const DETECTED_ENDPOINT_FULLPATH_RE =
  /\[DETECTED_ENDPOINT:\s*(\{[\s\S]*?\}|(?:\/(?:instagram\/analysis|instagram\/search|tiktok\/profile|tiktok\/search))|none)\s*\]/i;
const DETECTED_ENDPOINT_JSON_RE =
  /\{[\s\S]*"detectedEndpoint":\s*"(\/(?:instagram\/analysis|instagram\/search|tiktok\/profile|tiktok\/search))"[\s\S]*\}/;
const DETECTED_ENDPOINT_ALLOWED_RE =
  /^\/(?:instagram\/analysis|instagram\/search|tiktok\/profile|tiktok\/search)$/;

const STRIP_DETECTED_ENDPOINT_MARKER_RE =
  /\[DETECTED_ENDPOINT:[\s\S]*?\]/gi;

const SEARCH_RATE_LIMIT_TTL_SECONDS = 60 * 60; // 1 hour

export class SearchRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchRateLimitError';
  }
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly defaultModel = 'google/gemini-2.0-flash-001';
  private readonly llmClient: ChatOpenAI | null;
  private readonly sessionCreationByUserId = new Map<
    number,
    Promise<ChatSession>
  >();
  private readonly processingMessageByTaskId = new Map<
    string,
    Promise<number | null>
  >();
  private readonly pendingTaskResultByTaskId = new Map<string, string>();
  private readonly taskResultDeliveredByTaskId = new Set<string>();
  private getProcessingMessageContent(endpoint: ChatEndpoint): string {
    switch (endpoint) {
      case '/instagram/search':
      case '/tiktok/search':
        return 'Processing your request... This can take up to 20 minutes for search.';
      case '/tiktok/profile':
        return 'Processing your request... This can take up to 10 minutes for TikTok profile analysis.';
      case '/instagram/analysis':
        return 'Processing your request... This can take up to 5 minutes for Instagram profile analysis.';
      default:
        return 'Processing your request...';
    }
  }

  private getRequiredParamForEndpoint(endpoint: ChatEndpoint): 'query' | 'profile' {
    if (endpoint.includes('/search')) {
      return 'query';
    }
    return 'profile';
  }

  private extractDetectedEndpoint(content: string): {
    endpoint: ChatEndpoint | null;
    params: EndpointParams | null;
  } {
    const match = content.match(DETECTED_ENDPOINT_FULLPATH_RE);
    if (!match || !match[1]) {
      return { endpoint: null, params: null };
    }

    const rawValue = match[1].trim();
    if (rawValue.toLowerCase() === 'none') {
      return { endpoint: null, params: null };
    }

    try {
      // Try parsing as JSON first
      const parsed = JSON.parse(rawValue);
      const endpoint = parsed.endpoint as ChatEndpoint;
      const params = parsed.params as EndpointParams;

      if (DETECTED_ENDPOINT_ALLOWED_RE.test(endpoint)) {
        return { endpoint, params };
      }
    } catch {
      // Fallback: if not JSON, it might be just the endpoint path string
      if (DETECTED_ENDPOINT_ALLOWED_RE.test(rawValue)) {
        return { endpoint: rawValue as ChatEndpoint, params: null };
      }
    }

    return { endpoint: null, params: null };
  }

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly openrouterConfig: OpenrouterConfigService,
    private readonly sentry: SentryClientService,
    private readonly metricsService: MetricsService,
    private readonly chatMessagesRepo: ChatMessagesRepository,
    private readonly chatTasksRepo: ChatTasksRepository,
    private readonly chatSessionsRepo: ChatSessionsRepository,
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

  private async awaitWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T | null> {
    if (timeoutMs <= 0) {
      try {
        return await promise;
      } catch {
        return null;
      }
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), timeoutMs);
    });

    try {
      const result = await Promise.race([
        promise.catch(() => null),
        timeoutPromise,
      ]);
      return result as T | null;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async createSessionWithDedup(params: {
    userId: number;
    title: string | null;
  }): Promise<ChatSession> {
    const existing = this.sessionCreationByUserId.get(params.userId);
    if (existing) {
      const waitStart = Date.now();
      this.logger.log(
        `Waiting for in-flight session creation for user ${params.userId}`,
      );
      const session = await existing;
      const waitDuration = (Date.now() - waitStart) / 1000;
      if (waitDuration >= 5) {
        this.logger.warn(
          `Waited ${waitDuration.toFixed(3)}s for session creation (user ${params.userId})`,
        );
      }
      return session;
    }

    const startedAt = Date.now();
    const creationPromise = this.chatSessionsRepo.create({
      userId: params.userId,
      title: params.title,
    });
    this.sessionCreationByUserId.set(params.userId, creationPromise);

    try {
      const session = await creationPromise;
      const duration = (Date.now() - startedAt) / 1000;
      if (duration >= 5) {
        this.logger.warn(
          `Chat session creation took ${duration.toFixed(3)}s for user ${params.userId}`,
        );
      } else {
        this.logger.log(
          `Chat session creation took ${duration.toFixed(3)}s for user ${params.userId}`,
        );
      }
      return session;
    } finally {
      this.sessionCreationByUserId.delete(params.userId);
    }
  }

  private getModelLabel(): string {
    return this.openrouterConfig.model || this.defaultModel || 'unknown';
  }

  private buildSystemPrompt(): string {
    return `You are a helpful AI assistant for the Wykra API. 
You help users interact with social media analysis tools for Instagram and TikTok.

Available actions:
- Search for Instagram creators (requires query parameter)
- Analyze a specific Instagram profile (requires profile parameter)
- Search for TikTok creators (requires query parameter)
- Analyze a specific TikTok profile (requires profile parameter)

IMPORTANT: At the end of your response, you MUST include endpoint detection information in this exact JSON format on a new line:
[DETECTED_ENDPOINT: {"endpoint": "/instagram/search", "params": {"query": "extracted query"}}]
or
[DETECTED_ENDPOINT: {"endpoint": "/instagram/analysis", "params": {"profile": "username"}}]
or
[DETECTED_ENDPOINT: {"endpoint": "none", "params": {}}]

Detection rules:
- If the user wants to search, find, discover, or look for multiple creators/profiles/influencers based on a topic, niche, or location, use /instagram/search or /tiktok/search.
- If the user wants to analyze, check, or look at a SINGLE specific profile username or account, use /instagram/analysis or /tiktok/profile.
- If the query is not about Instagram or TikTok, use "none"

Parameter Extraction:
- For /instagram/analysis and /tiktok/profile, extract the profile username (e.g., "@sport.pl" -> "sport.pl").
- For /instagram/search and /tiktok/search, extract the search keywords.

When users ask about Instagram or TikTok, be helpful and explain what they can do.
Provide clear, concise responses.
DO NOT mention internal endpoint paths like "/instagram/search" or "/tiktok/profile" in the main body of your response. Instead, describe the action (e.g., "search for creators" or "analyze a profile").
The [DETECTED_ENDPOINT: ...] marker is for internal routing only and will be stripped before the user sees it. NEVER mention it or any endpoint paths to the user.

IMPORTANT formatting rules:
- Never use "*" or "**" symbols for formatting (no markdown bold or bullet points)
- Never use markdown formatting like **bold** or *italic*
- Always use plain text with newlines for lists
- Use numbered lists (1., 2., 3., etc.) when providing examples or lists
- Format lists with each item on a new line
- Use plain text section headers without markdown (e.g., "For Instagram:" not "**For Instagram:**")`;
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
    history: ChatMessage[] = [],
  ): Promise<{ content: string }> {
    this.logger.log(`invokeChatAssistant called for query: ${userQuery}, history length: ${history.length}`);
    const llmClient = this.ensureLLMClient();
    const model = this.getModelLabel();
    const llmServiceLabel = 'chat_assistant';
    const llmStartTime = Date.now();

    // Only keep the last 10 messages to avoid context confusion and token bloat
    const recentHistory = history.slice(-10);

    const historyMessages = recentHistory
      .filter((msg) => {
        const content = msg.content.trim();
        return (
          !content.startsWith('Error:') &&
          !content.startsWith('Processing your request')
        );
      })
      .map((msg) => {
        let content = msg.content;
        this.logger.log(
          `History message: role=${msg.role}, content=${content.substring(0, 50)}...`,
        );

        // Abbreviate large search/analysis results to keep context clean
      if (
        content.includes('[TIKTOK_PROFILE_ANALYSIS]') ||
        content.includes('[INSTAGRAM_PROFILE_ANALYSIS]') ||
        content.includes('Task completed! Here are the results:')
      ) {
        // Keep the first 500 characters and add a note
        if (content.length > 500) {
          content =
            content.substring(0, 500) +
            '\n... [Result abbreviated to preserve context window] ...';
        }
      }

      if (msg.role === ChatMessageRole.User) {
        return new HumanMessage(content);
      }
      return new AIMessage(content);
    });

    const messages = [
      new SystemMessage(this.buildSystemPrompt()),
      ...historyMessages,
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

      const content = this.normalizeLLMContent(response.content);
      this.logger.log(`invokeChatAssistant response: ${content}`);
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
      .trim();
  }

  private async safeCreateMessage(params: {
    userId: number;
    role: ChatMessageRole;
    content: string;
    detectedEndpoint: string | null;
    sessionId?: number | null;
    clientCreatedAt?: Date;
  }): Promise<{ id: number } | null> {
    this.logger.log(`safeCreateMessage: userId=${params.userId}, role=${params.role}, sessionId=${params.sessionId}, contentLen=${params.content.length}`);
    try {
      const created = await this.chatMessagesRepo.create({
        userId: params.userId,
        role: params.role,
        content: params.content,
        detectedEndpoint: params.detectedEndpoint,
        sessionId: params.sessionId ?? null,
        clientCreatedAt: params.clientCreatedAt ?? new Date(),
      });
      this.logger.log(`safeCreateMessage success: id=${created.id}`);
      return { id: created.id };
    } catch (error) {
      this.logger.error(
        `Failed to save message: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
  }

  private async safeUpdateMessage(
    messageId: number,
    patch: { content?: string; detectedEndpoint?: string | null },
    context: string,
  ): Promise<void> {
    this.logger.log(`safeUpdateMessage: id=${messageId}, context=${context}, contentLen=${patch.content?.length ?? 0}`);
    try {
      await this.chatMessagesRepo.update(messageId, patch);
      this.logger.log(`safeUpdateMessage success: id=${messageId}`);
    } catch (error) {
      this.logger.error(
        `Failed to update message (${context}): ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Gets chat history for a user and optional session
   */
  public async getHistory(
    userId: number,
    sessionId?: number,
  ): Promise<ChatMessage[]> {
    this.logger.log(`getHistory: userId=${userId}, sessionId=${sessionId}`);
    if (sessionId && sessionId > 0) {
      const messages = await this.chatMessagesRepo.findByUserIdAndSessionId(
        userId,
        sessionId,
      );
      this.logger.log(`getHistory: found ${messages.length} messages for session ${sessionId}`);
      return messages;
    }
    const messages = await this.chatMessagesRepo.findByUserId(userId);
    this.logger.log(`getHistory: found ${messages.length} messages for user ${userId}`);
    return messages;
  }

  /**
   * Extracts parameters for an endpoint from user query using LLM
   */
  private async extractEndpointParameters(
    endpoint: ChatEndpoint,
    userQuery: string,
  ): Promise<EndpointParams | null> {
    console.log(`extractEndpointParameters called for endpoint: ${endpoint}, userQuery: ${userQuery}`);
    this.logger.log(`extractEndpointParameters called for endpoint: ${endpoint}, userQuery: ${userQuery}`);
    process.stdout.write(`extractEndpointParameters called for endpoint: ${endpoint}, userQuery: ${userQuery}\n`);
    const llmClient = this.ensureLLMClient();

    let prompt = '';
    if (endpoint.includes('/search')) {
      prompt = `Extract the search query from the user's request. The user wants to search/discover creators.

User request: "${userQuery}"

Respond with ONLY a JSON object in this format:
{"query": "the extracted search query"}

IMPORTANT: If the user just says "instagram" or "tiktok" or "search" or "search creators" without specifying WHAT they want to search for (niche, category, name, or location), respond with:
{"missing": "query"}

Example:
- "search for profiles in Poland" -> query: "influencers in Poland"
- "find fashion creators" -> query: "fashion creators"
- "instagram" (after being asked for a platform) -> missing: "query" because no search term was provided.
- "i want to search creators in tiktok" -> missing: "query" because no search term (niche/location/etc) was provided.

If you cannot extract a clear search query even with context, respond with:
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
      const content = this.normalizeLLMContent(response.content);
      console.log(`extractEndpointParameters LLM response: ${content}`);
      this.logger.log(`extractEndpointParameters LLM response: ${content}`);
      process.stdout.write(`extractEndpointParameters LLM response: ${content}\n`);
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          query?: string;
          profile?: string;
          missing?: string;
        };
        console.log(`Parsed parameters: ${JSON.stringify(parsed)}`);
        this.logger.log(`Parsed parameters: ${JSON.stringify(parsed)}`);
        if (parsed.missing) {
          return null;
        }
        return parsed;
      }
      console.warn(`No JSON found in LLM response for parameters`);
      this.logger.warn(`No JSON found in LLM response for parameters`);
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
    sessionId: number | null,
  ): Promise<string | null> {
    console.log(`callEndpoint called for endpoint: ${endpoint}, params: ${JSON.stringify(params)}, userId: ${userId}, chatMessageId: ${chatMessageId}, sessionId: ${sessionId}`);
    this.logger.log(`callEndpoint called for endpoint: ${endpoint}, params: ${JSON.stringify(params)}, userId: ${userId}, chatMessageId: ${chatMessageId}, sessionId: ${sessionId}`);
    try {
      if (endpoint === '/instagram/search') {
        /*
        const key = `ratelimit:instagram_search:${userId}`;
        const existing = await this.cache.get(key);
        if (existing !== undefined && existing !== null) {
          this.logger.log(`Instagram search rate limit hit for user ${userId}`);
          return null; // Don't throw, just return null so handleDetectedEndpointFlow can handle it
        }
        */
      }
      if (endpoint === '/tiktok/search') {
        /*
        const key = `ratelimit:tiktok_search:${userId}`;
        const existing = await this.cache.get(key);
        if (existing !== undefined && existing !== null) {
          this.logger.log(`TikTok search rate limit hit for user ${userId}`);
          return null; // Don't throw, just return null so handleDetectedEndpointFlow can handle it
        }
        */
      }

      const endpointCallMap: Record<
        ChatEndpoint,
        (p: EndpointParams & { userId?: number }) => Promise<string>
      > = {
        '/instagram/analysis': async (p) =>
          await this.instagramService.profile(p.profile as string),
        '/instagram/search': async (p) =>
          await this.instagramService.search(p.query as string, p.userId),
        '/tiktok/profile': async (p) =>
          await this.tiktokService.profile(p.profile as string),
        '/tiktok/search': async (p) =>
          await this.tiktokService.search(p.query as string),
      };

      const required = this.getRequiredParamForEndpoint(endpoint);
      if (!params[required]) {
        return null;
      }

      const taskId = await endpointCallMap[endpoint]({
        ...params,
        userId,
      });

      /*
      if (endpoint === '/instagram/search' && taskId) {
        await this.cache.set(
          `ratelimit:instagram_search:${userId}`,
          1,
          SEARCH_RATE_LIMIT_TTL_SECONDS,
        );
      }
      if (endpoint === '/tiktok/search' && taskId) {
        await this.cache.set(
          `ratelimit:tiktok_search:${userId}`,
          1,
          SEARCH_RATE_LIMIT_TTL_SECONDS,
        );
      }
      */

      if (taskId) {
        const createdTask = await this.chatTasksRepo.create({
          userId,
          chatMessageId: chatMessageId || null,
          sessionId: sessionId || null,
          taskId,
          endpoint,
          status: 'pending',
        });
        this.logger.log(`Created chat task ${createdTask.id} (taskId: ${taskId}) for endpoint ${endpoint} in session ${sessionId}`);
      }

      return taskId;
    } catch (error) {
      if (error instanceof SearchRateLimitError) {
        throw error;
      }
      this.logger.error(
        `Failed to call endpoint ${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Polls task status and returns result when completed
   */
  private async pollTaskStatus(
    taskId: string,
    opts?: { timeoutMs?: number; intervalMs?: number },
  ): Promise<{
    status: string;
    result?: unknown;
    error?: string;
  }> {
    this.logger.log(`pollTaskStatus started for taskId: ${taskId}`);
    const timeoutMs =
      typeof opts?.timeoutMs === 'number' && opts.timeoutMs > 0
        ? opts.timeoutMs
        : 5 * 60 * 1000;
    const intervalMs =
      typeof opts?.intervalMs === 'number' && opts.intervalMs > 0
        ? opts.intervalMs
        : 5000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const { task } = await this.tasksService.getTaskStatus(taskId);
        this.logger.log(`Polling task ${taskId}: status=${task?.status}`);
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

        if (task.status === TaskStatus.Cancelled) {
          return { status: 'cancelled', error: task.error || 'Task cancelled' };
        }

        await this.sleep(intervalMs);
      } catch (error) {
        this.logger.warn(
          `Error polling task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        await this.sleep(intervalMs);
      }
    }

    return { status: 'timeout' };
  }

  private async handleDetectedEndpointFlow(params: {
    detectedEndpoint: ChatEndpoint;
    userQuery: string;
    userId: number;
    startTime: number;
    sessionId?: number;
    preExtractedParams?: EndpointParams | null;
  }): Promise<ChatResponse> {
    const {
      detectedEndpoint,
      userQuery,
      userId,
      startTime,
      sessionId,
      preExtractedParams,
    } = params;
    console.log(
      `handleDetectedEndpointFlow started: ${JSON.stringify({ detectedEndpoint, userQuery, userId, sessionId })}`,
    );
    this.logger.log(
      `handleDetectedEndpointFlow started: ${JSON.stringify({ detectedEndpoint, userQuery, userId, sessionId })}`,
    );
    this.logger.log(`Detected endpoint call: ${detectedEndpoint}`);

    let extractedParams = preExtractedParams;

    // Fast-track: Check for obvious profile analysis queries to avoid second LLM call
    if (!extractedParams && (detectedEndpoint === '/instagram/analysis' || detectedEndpoint === '/tiktok/profile')) {
      const profileMatch = userQuery.match(/(?:@|profile\s+|account\s+|check\s+|analyze\s+)([a-zA-Z0-9._-]+)/i);
      if (profileMatch && profileMatch[1]) {
        const username = profileMatch[1].replace(/^@/, '');
        if (username.length > 1) {
          this.logger.log(`Fast-track parameter extraction: profile=${username}`);
          extractedParams = { profile: username };
        }
      }
    }

    // Only call LLM if we don't have pre-extracted params
    if (!extractedParams) {
      extractedParams = await this.extractEndpointParameters(
        detectedEndpoint,
        userQuery,
      );
    }

    console.log(`Extracted params: ${JSON.stringify(extractedParams)}`);
    this.logger.log(`Extracted params: ${JSON.stringify(extractedParams)}`);

    const required = this.getRequiredParamForEndpoint(detectedEndpoint);
    if (!extractedParams || !extractedParams[required]) {
      const promptMessage =
        required === 'query'
          ? 'To search for profiles, I need a specific query. Please tell me what keywords, niche, or names you would like to use for the search (e.g., "fashion in Poland" or "fitness creators").'
          : `I need more information to proceed. Please provide the ${required} for this request.`;

      await this.safeCreateMessage({
        userId,
        role: ChatMessageRole.Assistant,
        content: promptMessage,
        detectedEndpoint: null,
        sessionId: sessionId && sessionId > 0 ? sessionId : null,
      });

      const duration = (Date.now() - startTime) / 1000;
      this.logger.log(`Chat response generated in ${duration.toFixed(3)}s`);
      return { response: promptMessage };
    }

    const processingMessageContent =
      this.getProcessingMessageContent(detectedEndpoint);
    const processingMessagePromise = this.safeCreateMessage({
      userId,
      role: ChatMessageRole.Assistant,
      content: processingMessageContent,
      detectedEndpoint: null,
      sessionId: sessionId && sessionId > 0 ? sessionId : null,
    });
    const processingMessageQuick = await this.awaitWithTimeout(
      processingMessagePromise,
      1500,
    );
    const processingMessageId = processingMessageQuick?.id ?? null;
    if (processingMessageId) {
      this.logger.log(
        `Created processing message: ${processingMessageId} for session ${sessionId}`,
      );
    } else {
      this.logger.warn(
        `Processing message creation is still pending for session ${sessionId}`,
      );
    }

    let taskId: string | null = null;
    try {
      taskId = await this.callEndpoint(
        detectedEndpoint,
        extractedParams,
        userId,
        processingMessageId,
        sessionId && sessionId > 0 ? sessionId : null,
      );
    } catch (error) {
      if (error instanceof SearchRateLimitError) {
        const rateLimitMessage = error.message;
        if (processingMessageId) {
          await this.safeUpdateMessage(
            processingMessageId,
            { content: rateLimitMessage, detectedEndpoint: null },
            'search rate limit',
          );
        } else {
          await this.safeCreateMessage({
            userId,
            role: ChatMessageRole.Assistant,
            content: rateLimitMessage,
            detectedEndpoint: null,
            sessionId: sessionId && sessionId > 0 ? sessionId : null,
          });
        }
        const duration = (Date.now() - startTime) / 1000;
        this.logger.log(
          `Chat response generated in ${duration.toFixed(3)}s (rate limited)`,
        );
        return { response: rateLimitMessage };
      }
      throw error;
    }

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
        void processingMessagePromise.then((message) => {
          if (!message?.id) return;
          void this.safeUpdateMessage(
            message.id,
            { content: errorMessage, detectedEndpoint: null },
            'task start failure (late processing message)',
          );
        });
        await this.safeCreateMessage({
          userId,
          role: ChatMessageRole.Assistant,
          content: errorMessage,
          detectedEndpoint: null,
        });
      }

      const duration = (Date.now() - startTime) / 1000;
      this.logger.log(`Chat response generated in ${duration.toFixed(3)}s`);
      return { response: errorMessage };
    }

    if (!processingMessageId) {
      const processingMessageIdPromise = processingMessagePromise
        .then((msg) => msg?.id ?? null)
        .catch(() => null);
      this.processingMessageByTaskId.set(taskId, processingMessageIdPromise);
      void processingMessageIdPromise.then(async (messageId) => {
        if (!messageId) return;
        try {
          await this.chatTasksRepo.update(taskId, {
            chatMessageId: messageId,
            sessionId: sessionId && sessionId > 0 ? sessionId : null,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to update chat task ${taskId} with processing message ${messageId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        const pendingResult = this.pendingTaskResultByTaskId.get(taskId);
        if (pendingResult) {
          const alreadyDelivered = this.taskResultDeliveredByTaskId.has(taskId);
          const replacement = alreadyDelivered
            ? 'Task completed. Results delivered in chat.'
            : pendingResult;
          await this.safeUpdateMessage(
            messageId,
            { content: replacement, detectedEndpoint: null },
            'late processing message update',
          );
          this.pendingTaskResultByTaskId.delete(taskId);
          this.taskResultDeliveredByTaskId.delete(taskId);
        }
      });
    }

    void this.handleTaskPolling(taskId, userId);

    const duration = (Date.now() - startTime) / 1000;
    this.logger.log(`Chat response generated in ${duration.toFixed(3)}s`);
    return { response: processingMessageContent, taskId, sessionId };
  }

  /**
   * Handles user chat queries as an AI assistant
   */
  public async chat(dto: ChatDTO, userId: number): Promise<ChatResponse> {
    const startTime = Date.now();
    this.logger.log(
      `Chat request started: userId=${userId}, sessionId=${dto.sessionId}, query="${dto.query.substring(0, 50)}..."`,
    );

    try {
      let sessionId = dto.sessionId;

      if (sessionId && sessionId > 0) {
        const session = await this.chatSessionsRepo.findByUserIdAndId(
          userId,
          sessionId,
        );
        if (!session) {
          this.logger.warn(`Session ${sessionId} not found for user ${userId}`);
          throw new BadRequestException(`Chat session not found`);
        }
      } else {
        // Create a new session automatically if none provided
        if (sessionId && sessionId < 0) {
          this.logger.warn(
            `Received placeholder sessionId ${sessionId} for user ${userId}`,
          );
        }
        const newSession = await this.createSessionWithDedup({
          userId,
          title: dto.query.substring(0, 50),
        });
        sessionId = newSession.id;
        this.logger.log(
          `Created new chat session ${sessionId} for user ${userId}`,
        );
      }

      // Save the user message without blocking the LLM call.
      const userMessageCreatedAt = new Date();
      const userMessagePromise = this.safeCreateMessage({
        userId,
        role: ChatMessageRole.User,
        content: dto.query,
        detectedEndpoint: null,
        sessionId: sessionId && sessionId > 0 ? sessionId : null,
        clientCreatedAt: userMessageCreatedAt,
      });
      void userMessagePromise.then((userMsg) => {
        this.logger.log(
          `Created user message: ${userMsg?.id} for session ${sessionId}`,
        );
      });

      const history = await this.getHistory(userId, sessionId);
      this.logger.log(
        `Loaded history for userId=${userId}, sessionId=${sessionId}: ${history.length} messages`,
      );

      // 2. Invoke the LLM
      const { content: rawContent } = await this.invokeChatAssistant(
        dto.query,
        history,
      );
      const { endpoint: detectedEndpoint, params: preExtractedParams } =
        this.extractDetectedEndpoint(rawContent);
      const cleanContent = this.cleanAssistantContent(rawContent);

      if (detectedEndpoint) {
        const duration = (Date.now() - startTime) / 1000;
      this.logger.log(
        `Chat response generated in ${duration.toFixed(3)}s (endpoint detected: ${detectedEndpoint})`,
      );
      const flowResult = await this.handleDetectedEndpointFlow({
        detectedEndpoint,
        userQuery: dto.query,
        userId,
        startTime,
        sessionId: sessionId,
        preExtractedParams,
      });
      return { ...flowResult, sessionId };
    }

    const assistantMessagePromise = this.safeCreateMessage({
      userId,
      role: ChatMessageRole.Assistant,
      content: cleanContent,
      detectedEndpoint: null,
      sessionId: sessionId && sessionId > 0 ? sessionId : null,
    });
    void assistantMessagePromise.then((assistantMsg) => {
      this.logger.log(
        `Created assistant message: ${assistantMsg?.id} for session ${sessionId}`,
      );
    });

    const duration = (Date.now() - startTime) / 1000;
    this.logger.log(`Chat response generated in ${duration.toFixed(3)}s`);
    return { response: cleanContent, sessionId };
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    this.logger.error(
      `Chat request failed after ${duration.toFixed(3)}s: ${error instanceof Error ? error.message : String(error)}`,
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
        // Ensure we always return the marker and the JSON on a new line
        return `${marker}\n${JSON.stringify(result)}`;
      }

      // For search results or other types, we might want to ensure they are also 
      // recognizable if they are just JSON.
      const jsonResult = JSON.stringify(result);
      if (endpoint?.includes('/search')) {
        return jsonResult;
      }

      return `Task completed! Here are the results:\n\n${JSON.stringify(result, null, 2)}`;
    }

    if (status === 'failed') {
      return `Task failed: ${error || 'Unknown error'}`;
    }

    if (status === 'cancelled') {
      const isSearch = typeof endpoint === 'string' && endpoint.includes('/search');
      const label = isSearch ? 'Search cancelled' : 'Analyze cancelled';
      this.logger.log(
        `Task ${params.status} for endpoint ${endpoint}, returning label: ${label}`,
      );
      return label;
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
    this.logger.log(`handleTaskPolling started for taskId: ${taskId}, userId: ${userId}`);
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

      const isTikTok =
        typeof endpoint === 'string' && endpoint.includes('/tiktok/');
      const taskResult = await this.pollTaskStatus(taskId, {
        // TikTok scraping/LLM can take 10-20+ minutes; keep polling longer.
        timeoutMs: isTikTok ? 30 * 60 * 1000 : 5 * 60 * 1000,
        intervalMs: isTikTok ? 10_000 : 5_000,
      });
      this.logger.log(`taskResult for ${taskId}: ${JSON.stringify(taskResult)}`);

      try {
        await this.chatTasksRepo.update(taskId, {
          status: taskResult.status as any,
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
      this.pendingTaskResultByTaskId.set(taskId, resultMessage);

      this.logger.log(`Task ${taskId} resultMessage length: ${resultMessage.length}`);
      if (resultMessage.includes('Processing your request')) {
        this.logger.warn(`Task ${taskId} resultMessage contains 'Processing your request'!`);
      }

      let finalChatMessageId = chatMessageId;
      if (!finalChatMessageId) {
        const pendingProcessingMessage =
          this.processingMessageByTaskId.get(taskId);
        if (pendingProcessingMessage) {
          finalChatMessageId = await this.awaitWithTimeout(
            pendingProcessingMessage,
            2000,
          );
        }
      }
      this.processingMessageByTaskId.delete(taskId);

      if (finalChatMessageId) {
        this.logger.log(
          `Updating message ${finalChatMessageId} with result for task ${taskId}`,
        );
        await this.safeUpdateMessage(
          finalChatMessageId,
          { content: resultMessage, detectedEndpoint: null },
          'task polling result update',
        );
        this.pendingTaskResultByTaskId.delete(taskId);
        this.taskResultDeliveredByTaskId.delete(taskId);
      } else {
        const sessionId = chatTask?.sessionId ?? null;
        this.logger.log(`Creating new message for task ${taskId} in session ${sessionId}`);
        await this.safeCreateMessage({
          userId,
          role: ChatMessageRole.Assistant,
          content: resultMessage,
          detectedEndpoint: null,
          sessionId,
        });
        this.taskResultDeliveredByTaskId.add(taskId);
        setTimeout(() => {
          this.pendingTaskResultByTaskId.delete(taskId);
          this.taskResultDeliveredByTaskId.delete(taskId);
        }, 10 * 60 * 1000);
      }
    } catch (error) {
      this.logger.error(
        `Error handling task polling for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Chat sessions
   */
  public async getSessions(userId: number) {
    return await this.chatSessionsRepo.findByUserId(userId);
  }

  public async createSession(userId: number, title: string | null) {
    return await this.createSessionWithDedup({ userId, title });
  }

  public async updateSessionTitle(
    userId: number,
    sessionId: number,
    title: string | null,
  ): Promise<{ id: number; title: string | null }> {
    const session = await this.chatSessionsRepo.findByUserIdAndId(
      userId,
      sessionId,
    );
    if (!session) {
      throw new Error('Chat session not found');
    }

    const normalized =
      typeof title === 'string' && title.trim().length > 0
        ? title.trim()
        : null;
    await this.chatSessionsRepo.updateTitle(userId, sessionId, normalized);
    return { id: sessionId, title: normalized };
  }

  public async deleteSession(userId: number, sessionId: number): Promise<void> {
    const session = await this.chatSessionsRepo.findByUserIdAndId(
      userId,
      sessionId,
    );
    if (!session) {
      throw new Error('Chat session not found');
    }

    const messages = await this.chatMessagesRepo.findByUserIdAndSessionId(
      userId,
      sessionId,
    );
    const messageIds = messages.map((m) => m.id);

    // chat_tasks.chat_message_id is nullable; null it out before deleting messages
    await this.chatTasksRepo.nullifyChatMessageIds(userId, messageIds);
    await this.chatMessagesRepo.deleteByUserIdAndSessionId(userId, sessionId);
    await this.chatSessionsRepo.deleteByUserIdAndId(userId, sessionId);
  }
}
