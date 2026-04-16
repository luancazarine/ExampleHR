import { IsString } from 'class-validator';

export class ApproveLeaveRequestDto {
  @IsString()
  reviewedBy: string;
}
