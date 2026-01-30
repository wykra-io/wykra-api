import { Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerException,
  ThrottlerLimitDetail,
} from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request } from 'express';

import { User } from '@libs/entities';
import { IS_PUBLIC_KEY, SKIP_THROTTLE_KEY } from '../constants';

@Injectable()
export class ApiTokenThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    // Skip throttling in development
    if (process.env.NODE_ENV === 'development') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const skipThrottle = this.reflector.getAllAndOverride<boolean>(
      SKIP_THROTTLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipThrottle) return true;

    // Skip throttling for admin users
    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    if (req?.user?.isAdmin) {
      return true;
    }

    // Never throttle Prometheus scraping from Railway internal network.
    const url: string = req?.originalUrl || req?.url || '';
    if (url === '/metrics' || url.startsWith('/metrics?')) {
      const rawHostRaw =
        req?.headers?.['x-forwarded-host'] || req?.headers?.host || '';
      const rawHost = Array.isArray(rawHostRaw)
        ? rawHostRaw[0]
        : rawHostRaw || '';
      const host = String(rawHost).split(',')[0]?.trim().split(':')[0] || '';
      if (host.endsWith('.railway.internal')) {
        return true;
      }
    }

    return super.shouldSkip(context);
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = req?.headers as { authorization?: string } | undefined;
    const auth = headers?.authorization;
    if (!auth?.startsWith('Bearer ')) {
      // Let ApiTokenGuard enforce 401; throttling is per-user/token.
      return Promise.resolve('unauthenticated');
    }

    const token = auth.slice(7);
    if (!token) return Promise.resolve('unauthenticated');

    return Promise.resolve(createHash('sha256').update(token).digest('hex'));
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  protected async throwThrottlingException(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: ExecutionContext,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new ThrottlerException('Rate is limited by 5 requests per hour');
  }
}
