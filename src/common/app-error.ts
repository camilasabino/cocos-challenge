export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown[];
}

/**
 * Application error with a stable, machine-readable `code`. The HTTP status is
 * carried here so a single exception filter can translate it at the transport
 * boundary without every caller depending on Nest's HttpException.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown[],
  ) {
    super(message);
    this.name = 'AppError';
  }

  static validation(details: unknown[]): AppError {
    return new AppError(400, 'VALIDATION_ERROR', 'Validation failed', details);
  }

  toBody(): ErrorBody {
    return {
      statusCode: this.statusCode,
      code: this.code,
      message: this.message,
      ...(this.details && { details: this.details }),
    };
  }
}
