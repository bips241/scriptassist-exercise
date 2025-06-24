import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const errorResponse = {
      success: false,
      statusCode: status,
      message: (exceptionResponse as any).message || exception.message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    // Log at appropriate levels
    if (status >= 500) {
      this.logger.error(`[${status}] ${request.method} ${request.url}`, exception.stack);
    } else {
      this.logger.warn(`[${status}] ${request.method} ${request.url} - ${errorResponse.message}`);
    }

    response.status(status).json(errorResponse);
  }
}
