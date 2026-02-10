import axios, { AxiosInstance, AxiosError } from 'axios';
import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';

import { OpenrouterConfigService } from '@libs/config';
import { SentryClientService } from '@libs/sentry';

import { MetricsService } from '../metrics';

export interface InstagramWebSearchResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

@Injectable()
export class InstagramWebSearchService {
  private readonly logger = new Logger(InstagramWebSearchService.name);
  private readonly http: AxiosInstance;

  // Force GPT-5.2 + web plugin for fresh URL discovery.
  private static readonly MODEL = 'openai/gpt-5.2';
  private static readonly SERVICE_NAME = 'instagram_web_search';

  constructor(
    private readonly openrouterConfig: OpenrouterConfigService,
    private readonly sentry: SentryClientService,
    private readonly metricsService: MetricsService,
  ) {
    const apiKey = this.openrouterConfig.apiKey;
    if (!apiKey) {
      // Create a client anyway; we'll throw a clearer error at call time.
      this.http = axios.create();
      return;
    }

    this.http = axios.create({
      baseURL: this.openrouterConfig.baseUrl,
      timeout: this.openrouterConfig.timeout,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wykra-api.com',
        'X-Title': 'Wykra API - Instagram Web Search',
        // Best-effort: explicitly disable any intermediary caching.
        'Cache-Control': 'no-store, no-cache, max-age=0',
        Pragma: 'no-cache',
      },
    });
  }

  private ensureConfigured(): void {
    if (!this.openrouterConfig.isConfigured) {
      throw new Error(
        'OpenRouter API key is not configured. Please set OPENROUTER_API_KEY environment variable.',
      );
    }
  }

  public async searchUrls(
    prompt: string,
    maxResults: number = 5,
    opts?: { signal?: AbortSignal; reasoningEffort?: string | null },
  ): Promise<InstagramWebSearchResponse> {
    this.ensureConfigured();

    const nonce = randomUUID();
    const startedAt = Date.now();

    try {
      const reasoning: Record<string, string> = {};
      if (opts?.reasoningEffort) {
        reasoning.effort = opts.reasoningEffort;
      }

      const res = await this.http.post<{
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      }>(
        '/chat/completions',
        {
          model: InstagramWebSearchService.MODEL,
          plugins: [
            { id: 'web', max_results: 3 }, // Always use 1 page to limit input tokens
          ],
          ...(Object.keys(reasoning).length > 0 ? { reasoning } : {}),
          temperature: 0,
          max_tokens: 10000, // Limit output tokens to 10,000
          messages: [
            {
              role: 'system',
              content: `You are performing open-web search to locate Instagram profile URLs. Return ONLY URLs, one per line, with no explanations or extra text.\nRequest nonce: ${nonce}\nDo not mention the nonce.`,
            },
            { role: 'user', content: prompt },
          ],
        },
        { signal: opts?.signal },
      );

      const duration = (Date.now() - startedAt) / 1000;
      const model =
        (typeof res.data?.model === 'string' && res.data.model) ||
        InstagramWebSearchService.MODEL;

      const content =
        (res.data?.choices?.[0]?.message?.content &&
          String(res.data.choices[0].message.content)) ||
        '';

      const usage = {
        promptTokens: Number(res.data?.usage?.prompt_tokens) || 0,
        completionTokens: Number(res.data?.usage?.completion_tokens) || 0,
        totalTokens: Number(res.data?.usage?.total_tokens) || 0,
      };

      this.metricsService.recordLLMCall(
        model,
        InstagramWebSearchService.SERVICE_NAME,
      );
      this.metricsService.recordLLMCallDuration(
        model,
        InstagramWebSearchService.SERVICE_NAME,
        duration,
        'success',
      );
      this.metricsService.recordLLMTokenUsage(
        model,
        InstagramWebSearchService.SERVICE_NAME,
        usage.promptTokens,
        usage.completionTokens,
        usage.totalTokens,
      );
      this.metricsService.recordLLMTokensPerRequest(
        'search',
        usage.promptTokens,
        usage.completionTokens,
      );

      return { content, model, usage };
    } catch (error) {
      const duration = (Date.now() - startedAt) / 1000;
      const model = InstagramWebSearchService.MODEL;

      this.metricsService.recordLLMCall(
        model,
        InstagramWebSearchService.SERVICE_NAME,
      );
      this.metricsService.recordLLMCallDuration(
        model,
        InstagramWebSearchService.SERVICE_NAME,
        duration,
        'error',
      );
      this.metricsService.recordLLMError(
        model,
        InstagramWebSearchService.SERVICE_NAME,
        'api_error',
      );

      const axiosError = error as AxiosError;
      this.logger.error(
        `OpenRouter web search request failed: ${axiosError.message}`,
        axiosError.response?.data,
      );
      this.sentry.sendException(error, {
        model,
        maxResults,
      });

      throw error;
    }
  }
}
