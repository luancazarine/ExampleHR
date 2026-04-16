import { IsString, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class BalanceRecordDto {
  @IsString()
  employeeId: string;

  @IsString()
  locationId: string;

  @IsString()
  leaveType: string;

  @IsNumber()
  totalDays: number;
}

export class WebhookSyncDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BalanceRecordDto)
  balances: BalanceRecordDto[];
}
