import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ledgerread/contracts';
import { AuthGuard } from '../auth/auth.guard';
import { AllowedRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentTraceId, CurrentUser } from '../common/current-user.decorator';
import {
  AddCartItemDto,
  CartItemParamsDto,
  CartParamsDto,
  CheckoutDto,
  UpdateCartItemDto,
} from './dto/pos.dto';
import { PosService } from './pos.service';

@Controller('pos')
@UseGuards(AuthGuard, RolesGuard)
@AllowedRoles('CLERK')
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Get('search')
  searchInventory(@Query('q') query?: string) {
    return this.posService.searchInventory(query);
  }

  @Post('carts')
  createCart(@CurrentUser() user: SessionUser, @CurrentTraceId() traceId: string) {
    return this.posService.createCart(user, traceId);
  }

  @Post('carts/:cartId/items')
  addItem(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Param() params: CartParamsDto,
    @Body() body: AddCartItemDto,
  ) {
    return this.posService.addItem(user, traceId, params.cartId, body);
  }

  @Patch('carts/:cartId/items/:cartItemId')
  updateItem(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Param() params: CartItemParamsDto,
    @Body() body: UpdateCartItemDto,
  ) {
    return this.posService.updateItem(user, traceId, params.cartId, params.cartItemId, body);
  }

  @Delete('carts/:cartId/items/:cartItemId')
  deleteItem(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Param() params: CartItemParamsDto,
  ) {
    return this.posService.deleteItem(user, traceId, params.cartId, params.cartItemId);
  }

  @Post('carts/:cartId/review-total')
  reviewTotal(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Param() params: CartParamsDto,
  ) {
    return this.posService.reviewTotal(user, traceId, params.cartId);
  }

  @Post('carts/:cartId/checkout')
  checkout(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Param() params: CartParamsDto,
    @Body() body: CheckoutDto,
  ) {
    return this.posService.checkout(user, traceId, params.cartId, body);
  }
}
