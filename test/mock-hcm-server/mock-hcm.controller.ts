import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { MockHcmService } from './mock-hcm.service';

@Controller('hcm')
export class MockHcmController {
  constructor(private readonly mockHcmService: MockHcmService) {}

  @Get('balances/:employeeId')
  async getBalances(
    @Param('employeeId') employeeId: string,
    @Res() res: Response,
  ) {
    await this.applyDelayAndErrors(res);
    if (res.headersSent) return;

    const balances = this.mockHcmService.getEmployeeBalances(employeeId);
    return res.json({
      balances: balances.map((b) => ({
        employeeId: b.employeeId,
        locationId: b.locationId,
        leaveType: b.leaveType,
        totalDays: b.totalDays,
      })),
    });
  }

  @Post('absences')
  async registerAbsence(@Body() body: any, @Res() res: Response) {
    await this.applyDelayAndErrors(res);
    if (res.headersSent) return;

    const errorMode = this.mockHcmService.getErrorMode();
    if (errorMode === 'reject_all') {
      return res.status(HttpStatus.BAD_REQUEST).json({
        message: 'All absences rejected (test mode)',
      });
    }

    const result = this.mockHcmService.registerAbsence(
      body.employeeId,
      body.locationId,
      body.leaveType,
      body.startDate,
      body.endDate,
      body.days,
    );

    if (result.status === 'REJECTED') {
      return res.status(HttpStatus.BAD_REQUEST).json(result);
    }

    return res.json(result);
  }

  @Delete('absences/:hcmReference')
  async cancelAbsence(
    @Param('hcmReference') hcmReference: string,
    @Res() res: Response,
  ) {
    await this.applyDelayAndErrors(res);
    if (res.headersSent) return;

    const result = this.mockHcmService.cancelAbsence(hcmReference);
    return res.json(result);
  }

  @Post('batch-sync')
  async batchSync(@Res() res: Response) {
    await this.applyDelayAndErrors(res);
    if (res.headersSent) return;

    const allBalances = this.mockHcmService.getAllBalances();
    return res.json({
      balances: allBalances.map((b) => ({
        employeeId: b.employeeId,
        locationId: b.locationId,
        leaveType: b.leaveType,
        totalDays: b.totalDays,
      })),
    });
  }

  // --- Test manipulation endpoints ---

  @Post('__test__/set-balance')
  setBalance(@Body() body: any) {
    this.mockHcmService.setBalance(
      body.employeeId,
      body.locationId,
      body.leaveType,
      body.totalDays,
      body.usedDays || 0,
    );
    return { status: 'ok' };
  }

  @Post('__test__/set-error-mode')
  setErrorMode(@Body() body: { mode: string }) {
    this.mockHcmService.setErrorMode(body.mode as any);
    return { status: 'ok', mode: body.mode };
  }

  @Post('__test__/add-bonus')
  addBonus(@Body() body: any) {
    this.mockHcmService.addBonus(
      body.employeeId,
      body.locationId,
      body.leaveType,
      body.bonusDays,
    );
    return { status: 'ok' };
  }

  @Post('__test__/set-delay')
  setDelay(@Body() body: { delayMs: number }) {
    this.mockHcmService.setDelay(body.delayMs);
    return { status: 'ok', delayMs: body.delayMs };
  }

  @Post('__test__/reset')
  reset() {
    this.mockHcmService.reset();
    return { status: 'ok' };
  }

  private async applyDelayAndErrors(res: Response): Promise<void> {
    const delay = this.mockHcmService.getDelay();
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const errorMode = this.mockHcmService.getErrorMode();
    if (errorMode === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      res.status(HttpStatus.GATEWAY_TIMEOUT).json({
        message: 'HCM timeout (test mode)',
      });
    } else if (errorMode === 'server_error') {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: 'HCM server error (test mode)',
      });
    }
  }
}
