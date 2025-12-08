import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { get, has, isArray, omit } from 'lodash';
import { Observable, map } from 'rxjs';

interface Response<T> {
  statusCode: number;
  message?: string;
  data: T;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, Response<T> | T>
{
  public intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T> | T> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest();
    const statusCode = ctx.getResponse().statusCode as number;

    // Skip transformation for metrics endpoint (Prometheus format)
    if (request.url === '/metrics' || request.path === '/metrics') {
      return next.handle();
    }

    return next.handle().pipe(
      map((value) => {
        let data: T;
        let message = 'Success';

        if (get(value, 'isExternal')) {
          return omit(value, ['isExternal']);
        }

        if (statusCode === 201) {
          message = 'Created successfully';
        }

        data = value as T;

        return { statusCode, data, message };
      }),
    );
  }
}
