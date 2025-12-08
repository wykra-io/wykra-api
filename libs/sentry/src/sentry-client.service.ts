import { Injectable } from '@nestjs/common';
import { CaptureContext } from '@sentry/core';
import * as Sentry from '@sentry/nestjs';

import { AppConfigService } from '@libs/config';

@Injectable()
export class SentryClientService {
  constructor(private readonly config: AppConfigService) {}

  /**
   * Sends an error to Sentry for monitoring and diagnostics (in production only).
   *
   * @param {Error} error - The error or exception to be reported.
   * @param {Record<string, unknown>} extra - Optional additional context or metadata to include in the Sentry report.
   *
   * @returns void
   */
  public sendException(error: unknown, extra?: Record<string, unknown>) {
    if (this.config.isProd) {
      Sentry.captureException(error, { extra });
    }
  }

  /**
   * Sends a message to Sentry for monitoring (in production only).
   *
   * @param {string} message - The message to be sent to Sentry.
   * @param {CaptureContext} context - Optional additional context or metadata associated with the message.
   *
   * @returns void
   */
  public sendMessage(message: string, context?: CaptureContext) {
    if (this.config.isProd) {
      Sentry.captureMessage(message, context);
    }
  }
}
