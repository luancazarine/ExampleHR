import { IsString, IsNumber, IsDateString, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLeaveRequestDto {
  @ApiProperty({ example: 'EMP001', description: 'Employee ID from HCM' })
  @IsString()
  employeeId: string;

  @ApiProperty({ example: 'LOC_US', description: 'Location ID for the balance to deduct from' })
  @IsString()
  locationId: string;

  @ApiProperty({ example: 'VACATION', description: 'Leave type (e.g. VACATION, SICK, PERSONAL)' })
  @IsString()
  leaveType: string;

  @ApiProperty({ example: '2026-05-01', description: 'First day of leave (ISO 8601)' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-05-02', description: 'Last day of leave (ISO 8601)' })
  @IsDateString()
  endDate: string;

  @ApiProperty({ example: 2, minimum: 0.5, description: 'Number of leave days requested' })
  @IsNumber()
  @Min(0.5)
  days: number;

  @ApiPropertyOptional({ example: 'Family vacation', description: 'Optional reason for the leave' })
  @IsOptional()
  @IsString()
  reason?: string;
}
