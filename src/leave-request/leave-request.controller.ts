import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { LeaveRequestService } from './leave-request.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { ApproveLeaveRequestDto } from './dto/approve-leave-request.dto';
import { RejectLeaveRequestDto } from './dto/reject-leave-request.dto';

@ApiTags('Leave Requests')
@Controller('leave-requests')
export class LeaveRequestController {
  constructor(
    private readonly leaveRequestService: LeaveRequestService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create leave request',
    description:
      'Creates a new leave request. Validates the employee balance locally and reserves the requested days atomically. ' +
      'The request starts in PENDING status awaiting manager approval.',
  })
  @ApiCreatedResponse({ description: 'Leave request created with PENDING status.' })
  @ApiBadRequestResponse({ description: 'Insufficient balance or invalid data.' })
  @ApiNotFoundResponse({ description: 'Employee not found.' })
  create(@Body() dto: CreateLeaveRequestDto) {
    return this.leaveRequestService.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get leave request by ID' })
  @ApiParam({ name: 'id', description: 'Leave request UUID' })
  @ApiOkResponse({ description: 'The leave request.' })
  @ApiNotFoundResponse({ description: 'Leave request not found.' })
  findById(@Param('id') id: string) {
    return this.leaveRequestService.findById(id);
  }

  @Get('employee/:employeeId')
  @ApiOperation({
    summary: 'List requests by employee',
    description: 'Returns all leave requests for an employee, optionally filtered by status.',
  })
  @ApiParam({ name: 'employeeId', description: 'The employee ID' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status (e.g. PENDING, APPROVED, CONFIRMED_BY_HCM)' })
  @ApiOkResponse({ description: 'Array of leave requests.' })
  findByEmployee(
    @Param('employeeId') employeeId: string,
    @Query('status') status?: string,
  ) {
    return this.leaveRequestService.findByEmployee(employeeId, status);
  }

  @Patch(':id/approve')
  @ApiOperation({
    summary: 'Approve leave request',
    description:
      'Manager approves a PENDING request. This triggers a call to the HCM to register the absence. ' +
      'If HCM confirms, status becomes CONFIRMED_BY_HCM. If HCM rejects, status becomes HCM_REJECTED. ' +
      'If HCM is unreachable, status becomes PENDING_HCM_CONFIRMATION for later retry.',
  })
  @ApiParam({ name: 'id', description: 'Leave request UUID' })
  @ApiOkResponse({ description: 'Updated leave request.' })
  @ApiConflictResponse({ description: 'Request is not in PENDING status.' })
  @ApiNotFoundResponse({ description: 'Leave request not found.' })
  approve(@Param('id') id: string, @Body() dto: ApproveLeaveRequestDto) {
    return this.leaveRequestService.approve(id, dto.reviewedBy);
  }

  @Patch(':id/reject')
  @ApiOperation({
    summary: 'Reject leave request',
    description: 'Manager rejects a PENDING request. Reserved days are released back to the balance.',
  })
  @ApiParam({ name: 'id', description: 'Leave request UUID' })
  @ApiOkResponse({ description: 'Rejected leave request.' })
  @ApiConflictResponse({ description: 'Request is not in PENDING status.' })
  @ApiNotFoundResponse({ description: 'Leave request not found.' })
  reject(@Param('id') id: string, @Body() dto: RejectLeaveRequestDto) {
    return this.leaveRequestService.reject(
      id,
      dto.reviewedBy,
      dto.reason,
    );
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary: 'Cancel leave request',
    description:
      'Cancels a request in PENDING, APPROVED, CONFIRMED_BY_HCM, or PENDING_HCM_CONFIRMATION status. ' +
      'Releases reserved or used days and notifies HCM if the absence was already registered.',
  })
  @ApiParam({ name: 'id', description: 'Leave request UUID' })
  @ApiOkResponse({ description: 'Cancelled leave request.' })
  @ApiConflictResponse({ description: 'Request cannot be cancelled in its current status.' })
  @ApiNotFoundResponse({ description: 'Leave request not found.' })
  cancel(@Param('id') id: string) {
    return this.leaveRequestService.cancel(id);
  }
}
