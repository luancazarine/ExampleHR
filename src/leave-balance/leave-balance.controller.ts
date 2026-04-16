import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
} from '@nestjs/common';
import { LeaveBalanceService } from './leave-balance.service';
import { WebhookSyncDto } from './dto/sync-balance.dto';

@Controller('leave-balances')
export class LeaveBalanceController {
  constructor(private readonly leaveBalanceService: LeaveBalanceService) {}

  @Get(':employeeId')
  getBalances(@Param('employeeId') employeeId: string) {
    return this.leaveBalanceService.getBalances(employeeId);
  }

  @Get(':employeeId/refresh')
  refreshFromHcm(@Param('employeeId') employeeId: string) {
    return this.leaveBalanceService.refreshFromHcm(employeeId);
  }

  @Post('sync')
  @HttpCode(200)
  triggerBatchSync() {
    return this.leaveBalanceService.triggerBatchSync();
  }

  @Post('webhook')
  @HttpCode(200)
  processWebhook(@Body() dto: WebhookSyncDto) {
    return this.leaveBalanceService.processWebhook(dto.balances);
  }
}
