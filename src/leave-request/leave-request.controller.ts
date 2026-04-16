import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { LeaveRequestService } from './leave-request.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { ApproveLeaveRequestDto } from './dto/approve-leave-request.dto';
import { RejectLeaveRequestDto } from './dto/reject-leave-request.dto';

@Controller('leave-requests')
export class LeaveRequestController {
  constructor(
    private readonly leaveRequestService: LeaveRequestService,
  ) {}

  @Post()
  create(@Body() dto: CreateLeaveRequestDto) {
    return this.leaveRequestService.create(dto);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.leaveRequestService.findById(id);
  }

  @Get('employee/:employeeId')
  findByEmployee(
    @Param('employeeId') employeeId: string,
    @Query('status') status?: string,
  ) {
    return this.leaveRequestService.findByEmployee(employeeId, status);
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveLeaveRequestDto) {
    return this.leaveRequestService.approve(id, dto.reviewedBy);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectLeaveRequestDto) {
    return this.leaveRequestService.reject(
      id,
      dto.reviewedBy,
      dto.reason,
    );
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.leaveRequestService.cancel(id);
  }
}
