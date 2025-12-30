import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

import { BrightdataConfigService, BrightdataDataset } from '@libs/config';
import { SentryClientService } from '@libs/sentry';

import { MetricsService } from '../../metrics';

@Injectable()
export class TikTokBrightdataService {
  private readonly logger = new Logger(TikTokBrightdataService.name);
  private readonly httpClient: AxiosInstance | null;

  constructor(
    private readonly brightdataConfig: BrightdataConfigService,
    private readonly sentry: SentryClientService,
    private readonly metricsService: MetricsService,
  ) {
    if (this.brightdataConfig.isConfigured) {
      this.httpClient = axios.create({
        baseURL: this.brightdataConfig.baseUrl,
        timeout: this.brightdataConfig.timeout,
        headers: {
          Authorization: `Bearer ${this.brightdataConfig.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
    } else {
      this.httpClient = null;
      this.logger.warn(
        'BrightData API key not configured. TikTok BrightData features will be unavailable.',
      );
    }
  }

  private ensureHttpClient(): AxiosInstance {
    if (!this.httpClient) {
      throw new Error(
        'BrightData API key is not configured. Please set BRIGHTDATA_API_KEY environment variable.',
      );
    }
    return this.httpClient;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async triggerDataset(
    datasetId: BrightdataDataset | string,
    triggerBody: unknown[],
    params: Record<string, string>,
  ): Promise<{ snapshot_id: string }> {
    const response = await this.ensureHttpClient().post<{
      snapshot_id: string;
    }>('/datasets/v3/trigger', triggerBody, {
      params: {
        dataset_id: datasetId,
        ...params,
      },
    });

    if (!response.data?.snapshot_id) {
      throw new Error('BrightData trigger did not return snapshot_id');
    }

    return response.data;
  }

  private async waitForSnapshot(
    snapshotId: string,
    opts?: { timeoutMs?: number; pollIntervalMs?: number },
  ): Promise<'ready'> {
    const timeoutMs = opts?.timeoutMs ?? 5 * 60 * 1000; // 5 minutes
    const pollIntervalMs = opts?.pollIntervalMs ?? 3000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const progress = await this.ensureHttpClient().get<{
        status?: string;
        error?: unknown;
      }>(`/datasets/v3/progress/${snapshotId}`);

      const status = String(progress.data?.status || '').toLowerCase();

      if (status === 'ready') {
        return 'ready';
      }

      if (status === 'failed' || status === 'error') {
        throw new Error(
          `BrightData snapshot ${snapshotId} failed: ${JSON.stringify(
            progress.data,
          )}`,
        );
      }

      await this.sleep(pollIntervalMs);
    }

    throw new Error(`Timed out waiting for BrightData snapshot ${snapshotId}`);
  }

  private async downloadSnapshot(
    snapshotId: string,
    format: 'json' | 'ndjson' = 'json',
  ): Promise<unknown> {
    const response = await this.ensureHttpClient().get(
      `/datasets/v3/snapshot/${snapshotId}`,
      {
        params: { format },
        // allow large responses
        responseType: 'text',
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      },
    );

    const body = response.data as string;

    if (format === 'ndjson') {
      const lines = body
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const items: unknown[] = [];
      for (const line of lines) {
        try {
          items.push(JSON.parse(line));
        } catch {
          // ignore malformed line
        }
      }
      return items;
    }

    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  public async runDatasetAndDownload(
    datasetId: BrightdataDataset | string,
    triggerBody: unknown[],
    params: Record<string, string>,
    metricName: string,
    opts?: { timeoutMs?: number; pollIntervalMs?: number },
  ): Promise<unknown[]> {
    const startTime = Date.now();
    try {
      const { snapshot_id } = await this.triggerDataset(
        datasetId,
        triggerBody,
        {
          include_errors: 'true',
          ...params,
        },
      );

      await this.waitForSnapshot(snapshot_id, {
        timeoutMs: opts?.timeoutMs ?? 25 * 60 * 1000,
        pollIntervalMs: opts?.pollIntervalMs ?? 4000,
      });

      const downloaded = await this.downloadSnapshot(snapshot_id, 'json');

      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordBrightdataCall(
        String(datasetId),
        metricName,
        duration,
      );

      if (Array.isArray(downloaded)) {
        return downloaded as unknown[];
      }

      if (downloaded && typeof downloaded === 'object') {
        return [downloaded] as unknown[];
      }

      return [];
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordBrightdataCall(
        String(datasetId),
        metricName,
        duration,
        'error',
      );
      this.logger.error(
        `BrightData runDatasetAndDownload failed (dataset=${String(
          datasetId,
        )}, metric=${metricName})`,
        error,
      );
      this.sentry.sendException(error, {
        datasetId: String(datasetId),
        metricName,
      });
      throw error;
    }
  }
}
