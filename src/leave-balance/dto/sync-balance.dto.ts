import { IsString, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class BalanceRecordDto {
  @ApiProperty({ example: 'EMP001', description: 'Employee ID' })
  @IsString()
  employeeId: string;

  @ApiProperty({ example: 'LOC_US', description: 'Location ID' })
  @IsString()
  locationId: string;

  @ApiProperty({ example: 'VACATION', description: 'Leave type' })
  @IsString()
  leaveType: string;

  @ApiProperty({ example: 20, description: 'Total entitled days' })
  @IsNumber()
  totalDays: number;
}

export class WebhookSyncDto {
  @ApiProperty({ type: [BalanceRecordDto], description: 'Array of balance records from HCM' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BalanceRecordDto)
  balances: BalanceRecordDto[];
}
