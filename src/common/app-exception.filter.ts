import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { AppError, ErrorBody } from './app-error';

interface JsonResponse {
  status(code: number): { json(body: unknown): unknown };
}

const FRAMEWORK_ERROR_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR', // e.g. malformed JSON body
  404: 'NOT_FOUND', // unknown route
};

/** Unexpected errors become a generic 500 so infrastructure details never reach clients. */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = this.toBody(exception);
    host
      .switchToHttp()
      .getResponse<JsonResponse>()
      .status(body.statusCode)
      .json(body);
  }

  private toBody(exception: unknown): ErrorBody {
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
