import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiParam,
} from '@nestjs/swagger';
import { LeaveBalanceService } from './leave-balance.service';
import { WebhookSyncDto } from './dto/sync-balance.dto';

@ApiTags('Leave Balances')
@Controller('leave-balances')
export class LeaveBalanceController {
  constructor(private readonly leaveBalanceService: LeaveBalanceService) {}

  @Get(':employeeId')
  @ApiOperation({
    summary: 'Get employee balances',
    description: 'Returns all cached leave balances for the given employee across locations and leave types.',
  })
  @ApiParam({ name: 'employeeId', description: 'The employee ID (from HCM)' })
  @ApiOkResponse({ description: 'Employee balances with available days calculated.' })
  @ApiNotFoundResponse({ description: 'Employee not found.' })
  getBalances(@Param('employeeId') employeeId: string) {
    return this.leaveBalanceService.getBalances(employeeId);
  }

  @Get(':employeeId/refresh')
  @ApiOperation({
    summary: 'Refresh balances from HCM',
    description:
      'Forces a real-time fetch of balances from the HCM system, updates the local cache, and returns the refreshed data.',
  })
  @ApiParam({ name: 'employeeId', description: 'The employee ID (from HCM)' })
  @ApiOkResponse({ description: 'Refreshed balances from HCM.' })
  @ApiNotFoundResponse({ description: 'Employee not found.' })
  refreshFromHcm(@Param('employeeId') employeeId: string) {
    return this.leaveBalanceService.refreshFromHcm(employeeId);
  }

  @Post('sync')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Trigger batch sync',
    description:
      'Fetches the complete set of balances from HCM and upserts them locally. ' +
      'Detects discrepancies between local usedDays and confirmed requests. Typically called by a cron job or admin.',
  })
  @ApiOkResponse({ description: 'Sync result with status and discrepancy count.' })
  triggerBatchSync() {
    return this.leaveBalanceService.triggerBatchSync();
  }

  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Receive HCM webhook',
    description:
      'Endpoint for the HCM to push balance updates. Processes the payload and updates local cache.',
  })
  @ApiOkResponse({ description: 'Webhook processed successfully.' })
  processWebhook(@Body() dto: WebhookSyncDto) {
    return this.leaveBalanceService.processWebhook(dto.balances);
  }
}
