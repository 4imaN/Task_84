import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class AttendanceDto {
  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @IsString()
  expectedChecksum?: string;
}

