import { IsISO8601, IsOptional } from 'class-validator';
import { NonBlankString } from '../../common/validation';

export class AttendanceDto {
  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @NonBlankString('expectedChecksum')
  expectedChecksum?: string;
}
