import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

import { BrightdataConfigService, BrightdataDataset } from '@libs/config';
import { SentryClientService } from '@libs/sentry';

import { MetricsService } from '../../metrics';

@Injectable()
export class TikTokBrightdataService {
  private readonly logger = new Logger(TikTokBrightdataService.name);
  private readonly httpClient: AxiosInstance | null;
  /** Default wait for snapshot. Profile analyze passes opts.timeoutMs: 15 min. */
  private static readonly ASYNC_WAIT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  private static readonly ASYNC_POLL_INTERVAL_MS = 5000;
  private static readonly ASYNC_MAX_RETRIES = 3;
  private static readonly ASYNC_RETRY_DELAY_MS = 2000;
  private static readonly SNAPSHOT_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes per download request

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

  private async sleepAbortable(
    ms: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!signal) return await this.sleep(ms);
    if (signal.aborted) {
      throw new Error('Aborted');
    }
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        signal.removeEventListener('abort', onAbort);
        reject(new Error('Aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async triggerDataset(
    datasetId: BrightdataDataset | string,
    triggerBody: unknown[],
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<{ snapshot_id: string }> {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }
    const response = await this.ensureHttpClient().post<{
      snapshot_id: string;
    }>('/datasets/v3/trigger', triggerBody, {
      params: {
        dataset_id: datasetId,
        ...params,
      },
      signal,
    });

    if (!response.data?.snapshot_id) {
      throw new Error('BrightData trigger did not return snapshot_id');
    }

    return response.data;
  }

  private async getSnapshotProgress(
    snapshotId: string,
    maxRetries: number,
    signal?: AbortSignal,
  ): Promise<{ status?: string; error?: unknown }> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (signal?.aborted) {
          throw new Error('Aborted');
        }
        const progress = await this.ensureHttpClient().get<{
          status?: string;
          error?: unknown;
        }>(`/datasets/v3/progress/${snapshotId}`, { signal });
        return progress.data ?? {};
      } catch (err) {
        lastErr = err;
        this.logger.warn(
          `BrightData progress attempt ${attempt}/${maxRetries} for snapshot ${snapshotId} failed`,
          err instanceof Error ? err.message : String(err),
        );
        if (attempt < maxRetries) {
          await this.sleepAbortable(
            TikTokBrightdataService.ASYNC_RETRY_DELAY_MS,
            signal,
          );
        }
      }
    }

    throw lastErr instanceof Error
      ? lastErr
      : new Error('BrightData progress check failed after retries');
  }

  private async waitForSnapshot(
    snapshotId: string,
    opts?: { timeoutMs?: number; pollIntervalMs?: number; maxRetries?: number },
  ): Promise<'ready'> {
    const timeoutMs =
      opts?.timeoutMs ?? TikTokBrightdataService.ASYNC_WAIT_TIMEOUT_MS;
    const pollIntervalMs =
      opts?.pollIntervalMs ?? TikTokBrightdataService.ASYNC_POLL_INTERVAL_MS;
    const maxRetries =
      opts?.maxRetries ?? TikTokBrightdataService.ASYNC_MAX_RETRIES;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if ((opts as { signal?: AbortSignal } | undefined)?.signal?.aborted) {
        throw new Error('Aborted');
      }
      let progressData: { status?: string; error?: unknown } | undefined;
      let lastErr: unknown;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const signal = (opts as { signal?: AbortSignal } | undefined)?.signal;
          if (signal?.aborted) {
            throw new Error('Aborted');
          }
          const progress = await this.ensureHttpClient().get<{
            status?: string;
            error?: unknown;
          }>(`/datasets/v3/progress/${snapshotId}`, { signal });
          progressData = progress.data ?? {};
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err;
          this.logger.warn(
            `BrightData progress attempt ${attempt}/${maxRetries} for snapshot ${snapshotId} failed`,
            err instanceof Error ? err.message : String(err),
          );
          if (attempt < maxRetries) {
            await this.sleepAbortable(
              TikTokBrightdataService.ASYNC_RETRY_DELAY_MS,
              (opts as { signal?: AbortSignal } | undefined)?.signal,
            );
          }
        }
      }

      if (!progressData) {
        throw lastErr instanceof Error
          ? lastErr
          : new Error('BrightData progress check failed after retries');
      }

      const status = String(progressData.status || '').toLowerCase();

      if (status === 'ready') {
        return 'ready';
      }

      if (status === 'failed' || status === 'error') {
        throw new Error(
          `BrightData snapshot ${snapshotId} failed: ${JSON.stringify(
            progressData,
          )}`,
        );
      }

      await this.sleepAbortable(
        pollIntervalMs,
        (opts as { signal?: AbortSignal } | undefined)?.signal,
      );
    }

    throw new Error(
      `Timed out waiting for BrightData snapshot ${snapshotId} (${timeoutMs}ms)`,
    );
  }

  private async downloadSnapshot(
    snapshotId: string,
    format: 'json' | 'ndjson' = 'json',
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }
    const response = await this.ensureHttpClient().get(
      `/datasets/v3/snapshot/${snapshotId}`,
      {
        params: { format },
        timeout: TikTokBrightdataService.SNAPSHOT_DOWNLOAD_TIMEOUT_MS,
        // allow large responses
        responseType: 'text',
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        signal,
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
    opts?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      maxRetries?: number;
      signal?: AbortSignal;
    },
  ): Promise<unknown[]> {
    const startTime = Date.now();
    try {
      const maxRetries =
        opts?.maxRetries ?? TikTokBrightdataService.ASYNC_MAX_RETRIES;
      const signal = opts?.signal;

      let snapshot_id: string | null = null;
      let lastTriggerError: unknown;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const resp = await this.triggerDataset(
            datasetId,
            triggerBody,
            {
              include_errors: 'true',
              ...params,
            },
            signal,
          );
          snapshot_id = resp.snapshot_id;
          break;
        } catch (err) {
          lastTriggerError = err;
          this.logger.warn(
            `BrightData trigger attempt ${attempt}/${maxRetries} failed (dataset=${String(
              datasetId,
            )})`,
            err instanceof Error ? err.message : String(err),
          );
          if (attempt < maxRetries) {
            await this.sleepAbortable(
              TikTokBrightdataService.ASYNC_RETRY_DELAY_MS,
              signal,
            );
          }
        }
      }

      if (!snapshot_id) {
        throw lastTriggerError instanceof Error
          ? lastTriggerError
          : new Error('BrightData trigger failed after retries');
      }

      const timeoutMs =
        opts?.timeoutMs ?? TikTokBrightdataService.ASYNC_WAIT_TIMEOUT_MS;
      const pollIntervalMs =
        opts?.pollIntervalMs ?? TikTokBrightdataService.ASYNC_POLL_INTERVAL_MS;

      const deadline = Date.now() + timeoutMs;
      let lastProgress: { status?: string; error?: unknown } | null = null;
      let lastDownloadError: unknown = null;

      // Robust flow: keep checking progress and retry downloads until deadline.
      while (Date.now() < deadline) {
        if (signal?.aborted) {
          throw new Error('Aborted');
        }
        // Poll progress (with retries) so we can surface status and stop on hard failures.
        lastProgress = await this.getSnapshotProgress(
          snapshot_id,
          maxRetries,
          signal,
        );
        const status = String(lastProgress.status ?? '').toLowerCase();

        if (status === 'failed' || status === 'error') {
          throw new Error(
            `BrightData snapshot ${snapshot_id} failed: ${JSON.stringify(
              lastProgress,
            )}`,
          );
        }

        // If ready (or status is unknown but could be ready), attempt download with retries.
        if (status === 'ready' || status === '') {
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              const downloaded = await this.downloadSnapshot(
                snapshot_id,
                'json',
                signal,
              );
              lastDownloadError = null;

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
            } catch (err) {
              lastDownloadError = err;
              this.logger.warn(
                `BrightData download attempt ${attempt}/${maxRetries} failed for snapshot ${snapshot_id}`,
                err instanceof Error ? err.message : String(err),
              );
              if (attempt < maxRetries) {
                await this.sleepAbortable(
                  TikTokBrightdataService.ASYNC_RETRY_DELAY_MS,
                  signal,
                );
              }
            }
          }
        }

        await this.sleepAbortable(pollIntervalMs, signal);
      }

      // Final attempt: sometimes progress polling can be flaky; try download one last time.
      try {
        const downloaded = await this.downloadSnapshot(
          snapshot_id,
          'json',
          signal,
        );
        lastDownloadError = null;

        const duration = (Date.now() - startTime) / 1000;
        this.metricsService.recordBrightdataCall(
          String(datasetId),
          metricName,
          duration,
        );

        if (Array.isArray(downloaded)) return downloaded as unknown[];
        if (downloaded && typeof downloaded === 'object')
          return [downloaded] as unknown[];
        return [];
      } catch (err) {
        lastDownloadError = err;
      }

      const lastStatus = lastProgress
        ? String(lastProgress.status ?? 'unknown')
        : 'unknown';
      throw new Error(
        `Timed out waiting for BrightData snapshot ${snapshot_id} (${timeoutMs}ms). Last status=${lastStatus}. Last download error=${String(
          lastDownloadError instanceof Error
            ? lastDownloadError.message
            : lastDownloadError,
        )}`,
      );
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
