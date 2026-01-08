import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const method: string = request.method;

    // Prefer Express' templated route (request.baseUrl + request.route.path) so we don't end up
    // with per-request cardinality (e.g. querystrings) and we keep controller prefixes.
    const baseUrl: string = request.baseUrl || '';
    const expressRoutePath: unknown = request.route?.path;

    let routePath: string;
    if (typeof expressRoutePath === 'string') {
      routePath = `${baseUrl}${expressRoutePath}`;
    } else {
      routePath = (request.originalUrl || request.url || '').toString();
    }

    // Strip query string and normalize trailing slash (except for root).
    routePath = routePath.split('?')[0] || routePath;
    if (routePath.length > 1 && routePath.endsWith('/')) {
      routePath = routePath.slice(0, -1);
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = (Date.now() - startTime) / 1000;
          const statusCode = response.statusCode || 200;
          this.metricsService.recordHttpRequest(
            method,
            routePath,
            statusCode,
            duration,
          );
        },
        error: (error) => {
          const duration = (Date.now() - startTime) / 1000;
          const statusCode = error.status || 500;
          this.metricsService.recordHttpRequest(
            method,
            routePath,
            statusCode,
            duration,
          );
        },
      }),
    );
  }
}
