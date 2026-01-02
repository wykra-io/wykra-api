import { Injectable } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerException,
  ThrottlerLimitDetail,
} from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import { createHash } from 'crypto';

import { IS_PUBLIC_KEY, SKIP_THROTTLE_KEY } from '../constants';

@Injectable()
export class ApiTokenThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
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

    return super.shouldSkip(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const auth: string | undefined = req?.headers?.authorization;
    if (!auth?.startsWith('Bearer ')) {
      // Let ApiTokenGuard enforce 401; throttling is per-user/token.
      return 'unauthenticated';
    }

    const token = auth.slice(7);
    if (!token) return 'unauthenticated';

    return createHash('sha256').update(token).digest('hex');
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
