import { Controller, Get, Param } from '@nestjs/common';
import { PortfolioParamsDto } from './portfolio-params.dto';
import { ApiGetPortfolio } from './portfolio.api';
import { PortfolioResponse, toPortfolioResponse } from './portfolio.response';
import { PortfolioService } from './portfolio.service';

@Controller('users')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get(':userId/portfolio')
  @ApiGetPortfolio()
  async getPortfolio(
    @Param() { userId }: PortfolioParamsDto,
  ): Promise<PortfolioResponse> {
    return toPortfolioResponse(await this.portfolio.getPortfolio(userId));
  }
}
