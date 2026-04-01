import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class AddCartItemDto {
  @IsString()
  sku!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class UpdateCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CartParamsDto {
  @IsUUID()
  cartId!: string;
}

export class CartItemParamsDto extends CartParamsDto {
  @IsUUID()
  cartItemId!: string;
}

export class CheckoutDto {
  @IsString()
  @IsIn(['CASH', 'EXTERNAL_TERMINAL'])
  paymentMethod!: 'CASH' | 'EXTERNAL_TERMINAL';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  paymentNote?: string;
}
