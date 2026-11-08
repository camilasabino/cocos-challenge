import { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import request from 'supertest';
import { PlaceOrderDto } from '../src/trading/orders/place-order.dto';
import { createTestApp } from './setup/create-test-app';

/* eslint-disable
  @typescript-eslint/no-explicit-any,
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-unsafe-argument,
  @typescript-eslint/no-unsafe-member-access,
  @typescript-eslint/no-unsafe-call,
  @typescript-eslint/no-unsafe-return
  -- the OpenAPI document is untyped JSON, navigated by path in these assertions */
type Json = any;

describe('OpenAPI documentation', () => {
  let app: INestApplication;
  let doc: Json;

  beforeAll(async () => {
    app = await createTestApp();
    doc = (
      await request(app.getHttpServer() as Server)
        .get('/api-json')
        .expect(200)
    ).body;
  });

  afterAll(async () => {
    await app.close();
  });

  const schema = (name: string): Json => doc.components.schemas[name];
  const operation = (path: string, method: string): Json =>
    doc.paths[path][method];

  it('serves Swagger UI at /api', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api')
      .expect(200);

    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('swagger-ui');
  });

  it('documents exactly the four endpoints', () => {
    expect(doc.openapi).toMatch(/^3\./);
    const operations = Object.entries(doc.paths).flatMap(([path, methods]) =>
      Object.keys(methods as object).map((method) => `${method} ${path}`),
    );
    expect(operations.sort()).toEqual([
      'get /health',
      'get /instruments/search',
      'get /users/{userId}/portfolio',
      'post /orders',
    ]);
  });

  describe('GET /instruments/search', () => {
    it('documents q as required and limit as an optional bounded integer', () => {
      const parameters = operation('/instruments/search', 'get').parameters;
      const byName = Object.fromEntries(
        parameters.map((p: Json) => [p.name, p]),
      );

      expect(byName.q).toMatchObject({ in: 'query', required: true });
      expect(byName.limit).toMatchObject({ in: 'query', required: false });
      expect(byName.limit.schema).toMatchObject({
        type: 'integer',
        minimum: 1,
        maximum: 50,
        default: 20,
      });
    });

    it('answers with an array of instruments', () => {
      const ok = operation('/instruments/search', 'get').responses['200'];
      const content = ok.content['application/json'].schema;

      expect(content.type).toBe('array');
      expect(content.items.$ref).toBe(
        '#/components/schemas/InstrumentResponse',
      );
      expect(schema('InstrumentResponse').required).toEqual(
        expect.arrayContaining(['id', 'ticker', 'name', 'type']),
      );
    });

    it('defines 200, 400 and 503', () => {
      expect(
        Object.keys(operation('/instruments/search', 'get').responses),
      ).toEqual(['200', '400', '503']);
    });
  });

  describe('GET /users/{userId}/portfolio', () => {
    it('documents userId as a required path integer', () => {
      const [param] = operation('/users/{userId}/portfolio', 'get').parameters;
      expect(param).toMatchObject({
        name: 'userId',
        in: 'path',
        required: true,
      });
      expect(param.schema).toMatchObject({ type: 'integer', minimum: 1 });
    });

    it('defines 200, 400, 404 and 503', () => {
      expect(
        Object.keys(operation('/users/{userId}/portfolio', 'get').responses),
      ).toEqual(['200', '400', '404', '503']);
    });

    it('documents monetary values as strings and the nullable valuation fields', () => {
      const portfolio = schema('PortfolioResponse');
      const position = schema('PositionResponse');

      for (const field of ['cashBalance', 'availableCash']) {
        expect(portfolio.properties[field]).toMatchObject({ type: 'string' });
        expect(portfolio.required).toContain(field);
      }
      expect(portfolio.properties.totalAccountValue).toMatchObject({
        type: 'string',
        nullable: true,
      });
      for (const field of [
        'lastPrice',
        'marketValue',
        'averageCost',
        'totalReturnPercent',
        'dailyPriceChangePercent',
      ]) {
        expect(position.properties[field]).toMatchObject({
          type: 'string',
          nullable: true,
        });
      }
      expect(position.properties.quantity).toMatchObject({ type: 'number' });
      expect(portfolio.properties.positions.items.$ref).toBe(
        '#/components/schemas/PositionResponse',
      );
    });
  });

  describe('POST /orders', () => {
    it('requires a JSON body referencing PlaceOrderDto', () => {
      const body = operation('/orders', 'post').requestBody;
      expect(body.required).toBe(true);
      expect(body.content['application/json'].schema.$ref).toBe(
        '#/components/schemas/PlaceOrderDto',
      );
    });

    it('requires userId, instrumentId, side and type; size, amount and price are optional', () => {
      const dto = schema('PlaceOrderDto');

      expect([...dto.required].sort()).toEqual(
        ['instrumentId', 'side', 'type', 'userId'].sort(),
      );
      expect(dto.properties.side.enum).toEqual(['BUY', 'SELL']);
      expect(dto.properties.type.enum).toEqual(['MARKET', 'LIMIT']);
      expect(dto.properties.size.type).toBe('integer');
      expect(dto.properties.amount.type).toBe('string');
      expect(dto.properties.price.type).toBe('string');
    });

    it('documents the cross-field rules', () => {
      const description = operation('/orders', 'post').description as string;

      expect(description).toMatch(
        /exactly one of `size` \(whole shares\) or `amount`/,
      );
      expect(description).toMatch(/`MARKET` must not carry a `price`/);
      expect(description).toMatch(/`LIMIT` requires `price`/);
      expect(description).toMatch(/REJECTED.*\*\*201\*\*/s);
      expect(description).toMatch(/idempotency/i);
    });

    it('defines 201, 400, 404, 422 and 503, and no 200', () => {
      expect(Object.keys(operation('/orders', 'post').responses)).toEqual([
        '201',
        '400',
        '404',
        '422',
        '503',
      ]);
    });

    it('documents the persisted order with its statuses and rejection reasons', () => {
      const order = schema('OrderResponse');

      expect(order.required).toEqual(
        expect.arrayContaining([
          'id',
          'userId',
          'instrumentId',
          'side',
          'type',
          'status',
          'size',
          'price',
          'datetime',
          'rejectionReason',
        ]),
      );
      expect(order.properties.status.enum).toEqual([
        'FILLED',
        'NEW',
        'REJECTED',
      ]);
      expect(order.properties.price.type).toBe('string');
      expect(order.properties.rejectionReason).toMatchObject({
        nullable: true,
        enum: ['INSUFFICIENT_FUNDS', 'INSUFFICIENT_SHARES'],
      });
      const created = operation('/orders', 'post').responses['201'];
      expect(Object.keys(created.content['application/json'].examples)).toEqual(
        ['filled', 'new', 'rejectedFunds', 'rejectedShares'],
      );
    });

    it('lists the 422 business errors', () => {
      const examples = operation('/orders', 'post').responses['422'].content[
        'application/json'
      ].examples;

      expect(Object.keys(examples)).toEqual([
        'INSTRUMENT_NOT_TRADABLE',
        'PRICE_UNAVAILABLE',
        'ZERO_QUANTITY',
        'QUANTITY_OUT_OF_RANGE',
      ]);
    });

    it('only offers request examples the endpoint accepts', async () => {
      const examples = operation('/orders', 'post').requestBody.content[
        'application/json'
      ].examples;

      for (const [name, example] of Object.entries<Json>(examples)) {
        const errors = await validate(
          plainToInstance(PlaceOrderDto, example.value as object),
          { whitelist: true, forbidNonWhitelisted: true },
        );
        expect({ name, errors }).toEqual({ name, errors: [] });
      }
    });
  });

  describe('GET /health', () => {
    it('defines 200 { status } and 503', () => {
      const health = operation('/health', 'get');

      expect(Object.keys(health.responses)).toEqual(['200', '503']);
      expect(schema('HealthResponse').properties.status.enum).toEqual(['ok']);
    });
  });

  describe('error contract', () => {
    it('shares one ErrorResponse schema across all documented errors', () => {
      expect(schema('ErrorResponse').required).toEqual([
        'statusCode',
        'code',
        'message',
      ]);
      expect(schema('ErrorResponse').properties.details.items.$ref).toBe(
        '#/components/schemas/ValidationErrorDetail',
      );

      for (const [, methods] of Object.entries<Json>(doc.paths)) {
        for (const op of Object.values<Json>(methods)) {
          for (const [status, response] of Object.entries<Json>(op.responses)) {
            if (Number(status) < 400) continue;
            expect(response.content['application/json'].schema.$ref).toBe(
              '#/components/schemas/ErrorResponse',
            );
          }
        }
      }
    });

    it('documents the 503 message without a retry hint', () => {
      const text = JSON.stringify(doc);

      expect(text).toContain('The service is temporarily unavailable');
      expect(text).not.toMatch(/please retry/i);
    });
  });
});
