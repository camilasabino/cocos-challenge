import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { describeDatabaseError } from '../common/database-errors';

/** Upper bound for the whole check, including waiting for a pooled connection. */
export const READINESS_TIMEOUT_MS = 2000;

@Injectable()
export class DatabaseReadiness {
  private readonly logger = new Logger(DatabaseReadiness.name);

  constructor(private readonly dataSource: DataSource) {}

  async isReady(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('readiness check timed out')),
        READINESS_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([this.dataSource.query('SELECT 1'), timedOut]);
      return true;
    } catch (error) {
      this.logger.warn(
        `Readiness check failed (${describeDatabaseError(error)})`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
