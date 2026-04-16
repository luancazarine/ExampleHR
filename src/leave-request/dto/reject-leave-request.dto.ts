import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RejectLeaveRequestDto {
  @ApiProperty({ example: 'MGR001', description: 'ID of the manager rejecting the request' })
  @IsString()
  reviewedBy: string;

  @ApiPropertyOptional({ example: 'Team coverage insufficient', description: 'Reason for rejection' })
  @IsOptional()
  @IsString()
  reason?: string;
}
