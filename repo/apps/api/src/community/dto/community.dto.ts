import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { NonBlankString, TrimmedString } from '../../common/validation';

export class CreateCommentDto {
  @IsUUID()
  @TrimmedString()
  titleId!: string;

  @IsOptional()
  @IsUUID()
  @TrimmedString()
  parentCommentId?: string;

  @IsString()
  @IsIn(['COMMENT', 'QUESTION'])
  commentType!: 'COMMENT' | 'QUESTION';

  @NonBlankString('body')
  @MaxLength(1000)
  body!: string;
}

export class CreateReportDto {
  @IsUUID()
  @TrimmedString()
  commentId!: string;

  @NonBlankString('category')
  category!: string;

  @NonBlankString('notes')
  notes!: string;
}

export class RelationshipDto {
  @IsUUID()
  @TrimmedString()
  targetUserId!: string;

  @Type(() => Boolean)
  @IsBoolean()
  active!: boolean;
}

export class RatingDto {
  @IsUUID()
  @TrimmedString()
  titleId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;
}

export class FavoriteDto {
  @IsUUID()
  @TrimmedString()
  titleId!: string;

  @Type(() => Boolean)
  @IsBoolean()
  active!: boolean;
}

export class SubscribeDto {
  @IsUUID()
  @TrimmedString()
  targetId!: string;

  @Type(() => Boolean)
  @IsBoolean()
  active!: boolean;
}
