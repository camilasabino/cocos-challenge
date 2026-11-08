import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error';
import { buildAccountLedger } from '../domain/account-ledger';
import {
  Portfolio,
  openPositionInstrumentIds,
  valuePortfolio,
} from '../domain/portfolio-valuation';
import { PortfolioReader } from './portfolio.reader';

@Injectable()
export class PortfolioService {
  constructor(private readonly reader: PortfolioReader) {}

  getPortfolio(userId: number): Promise<Portfolio> {
    return this.reader.inSnapshot(async (snapshot) => {
      if (!(await snapshot.userExists(userId))) {
        throw new AppError(404, 'USER_NOT_FOUND', `User ${userId} not found`);
      }

      const ledger = buildAccountLedger(
        await snapshot.findLedgerOrders(userId),
      );
      const instrumentIds = openPositionInstrumentIds(ledger);
      const instruments = await snapshot.findInstruments(instrumentIds);
      const prices = await snapshot.findLatestPrices(instrumentIds);

      return valuePortfolio({ userId, ledger, instruments, prices });
    });
  }
}
