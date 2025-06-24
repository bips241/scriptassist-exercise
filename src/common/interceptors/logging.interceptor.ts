import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;
    const url = req.url;
    const now = Date.now();

    this.logger.log(`Incoming Request: ${method} ${url} | Body: ${JSON.stringify(req.body)}`);

    return next.handle().pipe(
      tap({
        next: (val) => {
          this.logger.log(`Response: ${method} ${url} | Time: ${Date.now() - now}ms`);
        },
        error: (err) => {
          this.logger.error(`Error in ${method} ${url} | Time: ${Date.now() - now}ms | Error: ${err.message}`);
        },
      }),
    );
  }
}
