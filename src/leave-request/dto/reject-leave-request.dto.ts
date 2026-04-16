import { IsString, IsOptional } from 'class-validator';

export class RejectLeaveRequestDto {
  @IsString()
  reviewedBy: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
