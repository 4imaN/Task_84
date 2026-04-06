import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { NonBlankString } from '../../common/validation';

export class ReadingPreferencesDto {
  @IsString()
  @IsIn(['Merriweather', 'Noto Sans', 'Source Serif'])
  fontFamily!: 'Merriweather' | 'Noto Sans' | 'Source Serif';

  @Type(() => Number)
  @IsNumber()
  @Min(10)
  @Max(28)
  fontSize!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(2)
  lineSpacing!: number;

  @IsString()
  @IsIn(['PAGINATION', 'SCROLL'])
  readerMode!: 'PAGINATION' | 'SCROLL';

  @IsString()
  @IsIn(['linen', 'mist', 'sepia', 'paper'])
  theme!: 'linen' | 'mist' | 'sepia' | 'paper';

  @IsBoolean()
  nightMode!: boolean;

  @IsString()
  @IsIn(['SIMPLIFIED', 'TRADITIONAL'])
  chineseMode!: 'SIMPLIFIED' | 'TRADITIONAL';

  @IsISO8601()
  updatedAt!: string;
}

export class UpsertReadingProfileDto {
  @NonBlankString('deviceLabel')
  deviceLabel!: string;

  @ValidateNested()
  @Type(() => ReadingPreferencesDto)
  preferences!: ReadingPreferencesDto;
}

export class SyncReadingProfileDto extends UpsertReadingProfileDto {
  @Type(() => Boolean)
  @IsBoolean()
  strict!: boolean;
}
