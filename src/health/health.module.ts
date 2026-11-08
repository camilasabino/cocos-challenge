import { Module } from '@nestjs/common';
import { DatabaseReadiness } from './database-readiness';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [DatabaseReadiness],
})
export class HealthModule {}
