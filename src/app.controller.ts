import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('Admin')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check', description: 'Returns the current health status of the microservice.' })
  @ApiOkResponse({ description: 'Service is healthy.' })
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('sync-logs')
  @ApiOperation({ summary: 'List sync logs', description: 'Returns the 50 most recent synchronization logs (batch and real-time).' })
  @ApiOkResponse({ description: 'Array of sync log entries.' })
  getSyncLogs() {
    return this.appService.getSyncLogs();
  }
}
