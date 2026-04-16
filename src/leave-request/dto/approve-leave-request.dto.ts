import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ApproveLeaveRequestDto {
  @ApiProperty({ example: 'MGR001', description: 'ID of the manager approving the request' })
  @IsString()
  reviewedBy: string;
}
