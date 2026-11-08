import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { AppError, ErrorBody } from './app-error';
import {
  describeDatabaseError,
  isTemporarilyUnavailable,
} from './database-errors';

interface HttpContext {
  getResponse(): { status(code: number): { json(body: unknown): unknown } };
  getRequest(): { method: string; path: string };
}

const FRAMEWORK_ERROR_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR', // e.g. malformed JSON body
  404: 'NOT_FOUND', // unknown route
};

/**
 * Database availability failures become 503. A failure while committing leaves
 * the outcome of a write unknown, and without idempotency keys retrying a
 * POST /orders may create a duplicate order. Any other unexpected error becomes
 * a generic 500 so infrastructure details never reach clients.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http: HttpContext = host.switchToHttp();
    const body = this.toBody(exception, http);
    http.getResponse().status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, http: HttpContext): ErrorBody {
    if (exception instanceof AppError) return exception.toBody();

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      if (statusCode < 500) {
        return {
          statusCode,
          code: FRAMEWORK_ERROR_CODES[statusCode] ?? 'REQUEST_ERROR',
          message: exception.message,
        };
      }
    }

    if (isTemporarilyUnavailable(exception)) {
      const { method, path } = http.getRequest();
      this.logger.warn(
        `Database unavailable (${describeDatabaseError(exception)}) while handling ${method} ${path}`,
      );
      return AppError.serviceUnavailable().toBody();
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };
  }
}
