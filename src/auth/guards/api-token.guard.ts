import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from '../constants';
import { AuthService } from '../auth.service';

@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (!req) throw new UnauthorizedException();

    // Allow Prometheus scraping from Railway's internal network without auth.
    // This keeps `/metrics` protected on the public domain, while permitting
    // `*.railway.internal` to scrape.
    const url: string = req.originalUrl || req.url || '';
    if (url === '/metrics' || url.startsWith('/metrics?')) {
      const rawHostHeader =
        req.headers?.['x-forwarded-host'] ?? req.headers?.host;
      const rawHost = Array.isArray(rawHostHeader)
        ? rawHostHeader[0]
        : rawHostHeader || '';
      const host = String(rawHost).split(',')[0]?.trim().split(':')[0] || '';
      if (host.endsWith('.railway.internal')) {
        return true;
      }
    }

    const user = await this.authService.apiAuthFromRequest(req);
    (req as Request & { user?: unknown }).user = user;

    return true;
  }
}
