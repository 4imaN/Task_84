import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { NonBlankString, TrimmedString } from '../../common/validation';

export class ModerationActionDto {
  @IsOptional()
  @IsUUID()
  @TrimmedString()
  reportId?: string;

  @IsOptional()
  @IsUUID()
  @TrimmedString()
  targetUserId?: string;

  @IsOptional()
  @IsUUID()
  @TrimmedString()
  targetCommentId?: string;

  @IsString()
  @IsIn(['hide', 'restore', 'remove', 'suspend'])
  action!: 'hide' | 'restore' | 'remove' | 'suspend';

  @NonBlankString('notes')
  notes!: string;
}
