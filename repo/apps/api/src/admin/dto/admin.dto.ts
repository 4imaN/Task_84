import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ManifestItemDto {
  @IsString()
  sku!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  statementQuantity!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  invoiceQuantity!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  statementExtendedAmountCents!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  invoiceExtendedAmountCents!: number;
}

export class ImportManifestDto {
  @IsString()
  supplierName!: string;

  @IsString()
  sourceFilename!: string;

  @IsString()
  statementReference!: string;

  @IsString()
  invoiceReference!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  freightCents!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  surchargeCents!: number;

  @IsString()
  @IsIn(['PENDING', 'MATCHED', 'PARTIAL', 'PAID', 'DISPUTED'])
  paymentPlanStatus!: 'PENDING' | 'MATCHED' | 'PARTIAL' | 'PAID' | 'DISPUTED';

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ManifestItemDto)
  items!: ManifestItemDto[];
}
