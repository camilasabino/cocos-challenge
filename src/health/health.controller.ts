import { Controller, Get } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { DatabaseReadiness } from './database-readiness';
import { ApiHealth } from './health.api';
import { HealthResponse } from './health.response';

@Controller('health')
export class HealthController {
  constructor(private readonly readiness: DatabaseReadiness) {}

  @Get()
  @ApiHealth()
  async check(): Promise<HealthResponse> {
    if (!(await this.readiness.isReady())) {
      throw AppError.serviceUnavailable();
    }
    return { status: 'ok' };
  }
}
