import {
  INestApplication,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { AppError } from './common/app-error';
import { AppExceptionFilter } from './common/app-exception.filter';
import { setupOpenApi } from './openapi';

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
  setupOpenApi(app);
}
