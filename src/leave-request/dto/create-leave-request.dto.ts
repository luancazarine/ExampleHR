import { IsString, IsNumber, IsDateString, IsOptional, Min } from 'class-validator';

export class CreateLeaveRequestDto {
  @IsString()
  employeeId: string;

  @IsString()
  locationId: string;

  @IsString()
  leaveType: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsNumber()
  @Min(0.5)
  days: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
