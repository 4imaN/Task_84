import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class ModerationActionDto {
  @IsOptional()
  @IsUUID()
  reportId?: string;

  @IsOptional()
  @IsUUID()
  targetUserId?: string;

  @IsOptional()
  @IsUUID()
  targetCommentId?: string;

  @IsString()
  @IsIn(['hide', 'restore', 'remove', 'suspend'])
  action!: 'hide' | 'restore' | 'remove' | 'suspend';

  @IsString()
  notes!: string;
}
