import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_UI_PATH = 'api';
export const OPENAPI_JSON_PATH = 'api-json';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Cocos Challenge API')
    .setVersion('1.0.0')
    .setDescription(
      [
        'Brokerage account API: portfolio, instrument search and order placement.',
        '',
        'There is no authentication: `userId` is supplied by the caller. Prices and amounts are in ARS and travel as decimal strings.',
        'Errors share one body: `{ statusCode, code, message, details? }`.',
      ].join('\n'),
    )
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function setupOpenApi(app: INestApplication): void {
  SwaggerModule.setup(SWAGGER_UI_PATH, app, buildOpenApiDocument(app), {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
  });
}
