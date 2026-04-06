import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { NonBlankString, TrimmedString } from '../../common/validation';

export const MAX_AUDIT_LOG_LIMIT = 100;

export class ManifestItemDto {
  @NonBlankString('sku')
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
  @NonBlankString('supplierName')
  supplierName!: string;

  @NonBlankString('sourceFilename')
  sourceFilename!: string;

  @NonBlankString('statementReference')
  statementReference!: string;

  @NonBlankString('invoiceReference')
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

export class UpdatePaymentPlanStatusDto {
  @IsString()
  @IsIn(['PENDING', 'MATCHED', 'PARTIAL', 'PAID', 'DISPUTED'])
  status!: 'PENDING' | 'MATCHED' | 'PARTIAL' | 'PAID' | 'DISPUTED';
}

export class UpdateDiscrepancyStatusDto {
  @IsString()
  @IsIn(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'WAIVED'])
  status!: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'WAIVED';
}

export class GetAuditLogsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AUDIT_LOG_LIMIT)
  limit?: number;

  @IsOptional()
  @TrimmedString()
  @IsString()
  action?: string;
}
