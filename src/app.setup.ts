import {
  INestApplication,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { AppError } from './common/app-error';
import { AppExceptionFilter } from './common/app-exception.filter';

/**
 * Global HTTP behavior shared by the real server and the functional tests, so
 * tests exercise exactly the validation and error handling that ships.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) =>
        AppError.validation(
          errors.flatMap((error) =>
            Object.values(error.constraints ?? {}).map((message) => ({
              field: error.property,
              message,
            })),
          ),
        ),
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());
}
