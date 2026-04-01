import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCommentDto {
  @IsUUID()
  titleId!: string;

  @IsOptional()
  @IsUUID()
  parentCommentId?: string;

  @IsString()
  @IsIn(['COMMENT', 'QUESTION'])
  commentType!: 'COMMENT' | 'QUESTION';

  @IsString()
  @MaxLength(1000)
  body!: string;
}

export class CreateReportDto {
  @IsUUID()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  commentId!: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @Matches(/\S/, { message: 'category should not be empty.' })
  category!: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @Matches(/\S/, { message: 'notes should not be empty.' })
  notes!: string;
}

export class RelationshipDto {
  @IsUUID()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  targetUserId!: string;

  @Type(() => Boolean)
  @IsBoolean()
  active!: boolean;
}

export class RatingDto {
  @IsUUID()
  titleId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;
}

export class FavoriteDto {
  @IsUUID()
  titleId!: string;

  @Type(() => Boolean)
  @IsBoolean()
  active!: boolean;
}

export class SubscribeDto {
  @IsUUID()
  targetId!: string;

  @Type(() => Boolean)
  @IsBoolean()
  active!: boolean;
}
