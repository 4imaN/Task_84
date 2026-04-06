import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { SessionUser } from '@ledgerread/contracts';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type Queryable } from '../database/database.service';
import { SecurityService } from '../security/security.service';
import type { AddCartItemDto, CheckoutDto, UpdateCartItemDto } from './dto/pos.dto';

interface CartLine {
  cart_item_id: string;
  inventory_item_id: string;
  sku: string;
  name: string;
  quantity: number;
  price_cents: number;
  on_hand: number;
  freight_cents: number;
  surcharge_cents: number;
  moving_average_cost_cents: number;
}

interface InventorySuggestionRow {
  sku: string;
  name: string;
  on_hand: number;
  price_cents: number;
  title_name: string | null;
  format: string | null;
}

interface CartComputation {
  lines: CartLine[];
  suggestions: Array<{ sku: string; name: string }>;
  stockIssues: Array<{
    sku: string;
    requestedQuantity: number;
    availableQuantity: number;
  }>;
  subtotalCents: number;
  discountCents: number;
  feeCents: number;
  totalCents: number;
  reviewSignature: string;
  reviewSnapshot: Record<string, unknown>;
}

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly securityService: SecurityService,
  ) {}

  async searchInventory(query?: string) {
    const term = query?.trim();
    if (!term) {
      return [];
    }

    const prefix = `${term}%`;
    const contains = `%${term}%`;
    const result = await this.databaseService.query<InventorySuggestionRow>(
      `
      SELECT inventory_items.sku,
             inventory_items.name,
             inventory_items.on_hand,
             inventory_items.price_cents,
             titles.name AS title_name,
             titles.format
      FROM inventory_items
      LEFT JOIN titles ON titles.id = inventory_items.title_id
      WHERE inventory_items.sku ILIKE $1
         OR inventory_items.name ILIKE $1
         OR COALESCE(titles.name, '') ILIKE $1
         OR inventory_items.sku ILIKE $2
         OR inventory_items.name ILIKE $2
         OR COALESCE(titles.name, '') ILIKE $2
      ORDER BY CASE
                 WHEN inventory_items.sku ILIKE $1 THEN 0
                 WHEN inventory_items.name ILIKE $1 THEN 1
                 WHEN COALESCE(titles.name, '') ILIKE $1 THEN 2
                 ELSE 3
               END,
               inventory_items.name ASC
      LIMIT 8
      `,
      [prefix, contains],
    );

    return result.rows.map((row: InventorySuggestionRow) => ({
      sku: row.sku,
      name: row.name,
      titleName: row.title_name,
      format: row.format,
      onHand: row.on_hand,
      price: row.price_cents / 100,
    }));
  }

  async createCart(user: SessionUser, traceId: string) {
    const result = await this.databaseService.query<{ id: string }>(
      'INSERT INTO carts (clerk_user_id) VALUES ($1) RETURNING id',
      [user.id],
    );

    await this.auditService.write({
      traceId,
      actorUserId: user.id,
      action: 'CART_CREATED',
      entityType: 'cart',
      entityId: result.rows[0]!.id,
      payload: {},
    });

    return { cartId: result.rows[0]!.id };
  }

  private async ensureOpenCart(
    clerkUserId: string,
    cartId: string,
    queryable: Queryable = this.databaseService,
    options?: { lockForUpdate?: boolean },
  ) {
    const cart = await queryable.query<{ id: string; status: string }>(
      `
      SELECT id, status
      FROM carts
      WHERE id = $1 AND clerk_user_id = $2
      ${options?.lockForUpdate ? 'FOR UPDATE' : ''}
      `,
      [cartId, clerkUserId],
    );

    if (!cart.rows[0]) {
      throw new NotFoundException('Cart not found.');
    }

    if (cart.rows[0].status !== 'OPEN') {
      throw new ConflictException('Only open carts can be modified.');
    }
  }

  private async ensureCartItem(
    clerkUserId: string,
    cartId: string,
    cartItemId: string,
    queryable: Queryable = this.databaseService,
    options?: { lockCartForUpdate?: boolean },
  ) {
    const openCartOptions = options?.lockCartForUpdate ? { lockForUpdate: true } : undefined;
    await this.ensureOpenCart(clerkUserId, cartId, queryable, openCartOptions);
    const cartItem = await queryable.query<{ id: string }>(
      `
      SELECT cart_items.id
      FROM cart_items
      JOIN carts ON carts.id = cart_items.cart_id
      WHERE cart_items.id = $1
        AND cart_items.cart_id = $2
        AND carts.clerk_user_id = $3
      `,
      [cartItemId, cartId, clerkUserId],
    );

    if (!cartItem.rows[0]) {
      throw new NotFoundException('Cart item not found.');
    }
  }

  private async getCartLines(
    cartId: string,
    queryable: Queryable = this.databaseService,
    options?: { lockRows?: boolean },
  ): Promise<CartLine[]> {
    const result = await queryable.query<CartLine>(
      `
      SELECT cart_items.id AS cart_item_id,
             inventory_items.id AS inventory_item_id,
             inventory_items.sku,
             inventory_items.name,
             cart_items.quantity,
             inventory_items.price_cents,
             inventory_items.on_hand,
             inventory_items.freight_cents,
             inventory_items.surcharge_cents,
             inventory_items.moving_average_cost_cents
      FROM cart_items
      JOIN inventory_items ON inventory_items.id = cart_items.inventory_item_id
      WHERE cart_items.cart_id = $1
      ORDER BY cart_items.created_at ASC
      ${options?.lockRows ? 'FOR UPDATE OF cart_items, inventory_items' : ''}
      `,
      [cartId],
    );

    return result.rows;
  }

  private async computeCart(
    cartId: string,
    queryable: Queryable = this.databaseService,
    options?: { lockRows?: boolean },
  ): Promise<CartComputation> {
    const lines: CartLine[] = await this.getCartLines(cartId, queryable, options);
    const itemIds = lines.map((line) => line.inventory_item_id);
    const suggestions =
      itemIds.length === 0
        ? []
        : (
            await queryable.query<{ sku: string; name: string }>(
              `
              SELECT DISTINCT inventory_items.sku, inventory_items.name
              FROM bundle_links
              JOIN inventory_items ON inventory_items.id = bundle_links.complementary_item_id
              WHERE bundle_links.inventory_item_id = ANY($1::uuid[])
              `,
              [itemIds],
            )
          ).rows;

    const subtotalCents = lines.reduce(
      (sum: number, line: CartLine) => sum + line.price_cents * line.quantity,
      0,
    );
    const feeCents = lines.reduce(
      (sum: number, line: CartLine) => sum + (line.freight_cents + line.surcharge_cents) * line.quantity,
      0,
    );
    const inCart = new Set(itemIds);
    let discountCents = 0;

    if (itemIds.length > 0) {
      const bundlePairs = await queryable.query<{
        inventory_item_id: string;
        complementary_item_id: string;
      }>(
        `
        SELECT inventory_item_id, complementary_item_id
        FROM bundle_links
        WHERE inventory_item_id = ANY($1::uuid[])
        `,
        [itemIds],
      );

      const appliedBundlePairs = new Set<string>();
      discountCents = bundlePairs.rows.reduce(
        (
          sum: number,
          pair: { inventory_item_id: string; complementary_item_id: string },
        ) => {
          if (!inCart.has(pair.complementary_item_id)) {
            return sum;
          }

          const normalizedPairKey = [pair.inventory_item_id, pair.complementary_item_id].sort().join(':');
          if (appliedBundlePairs.has(normalizedPairKey)) {
            return sum;
          }

          appliedBundlePairs.add(normalizedPairKey);
          return sum + 300;
        },
        0,
      );
    }

    const stockIssues = lines
      .filter((line: CartLine) => line.quantity > line.on_hand)
      .map((line: CartLine) => ({
        sku: line.sku,
        requestedQuantity: line.quantity,
        availableQuantity: line.on_hand,
      }));

    const reviewSnapshot = {
      cartId,
      items: lines.map((line: CartLine) => ({
        cartItemId: line.cart_item_id,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.price_cents / 100,
        onHand: line.on_hand,
        freightCents: line.freight_cents,
        surchargeCents: line.surcharge_cents,
      })),
      suggestions,
      stockIssues,
      subtotalCents,
      discountCents,
      feeCents,
      totalCents: subtotalCents - discountCents + feeCents,
    };

    return {
      lines,
      suggestions,
      stockIssues,
      subtotalCents,
      discountCents,
      feeCents,
      totalCents: subtotalCents - discountCents + feeCents,
      reviewSignature: this.securityService.hashChain(reviewSnapshot, null),
      reviewSnapshot,
    };
  }

  private buildSummary(cartId: string, computation: CartComputation, reviewedAt?: string | null) {
    return {
      cartId,
      items: computation.lines.map((line: CartLine) => ({
        cartItemId: line.cart_item_id,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.price_cents / 100,
        onHand: line.on_hand,
      })),
      suggestions: computation.suggestions,
      stockIssues: computation.stockIssues,
      subtotal: computation.subtotalCents / 100,
      discount: computation.discountCents / 100,
      fees: computation.feeCents / 100,
      total: computation.totalCents / 100,
      reviewReady: Boolean(reviewedAt),
      reviewedAt,
    };
  }

  private async clearReviewState(cartId: string, queryable: Queryable = this.databaseService) {
    await queryable.query(
      `
      UPDATE carts
      SET review_signature = NULL,
          reviewed_at = NULL,
          reviewed_total_cents = NULL,
          review_snapshot = NULL
      WHERE id = $1
      `,
      [cartId],
    );
  }

  async addItem(user: SessionUser, traceId: string, cartId: string, input: AddCartItemDto) {
    return this.databaseService.withTransaction(async (client) => {
      await this.ensureOpenCart(user.id, cartId, client, { lockForUpdate: true });
      const inventory = await client.query<{ id: string }>(
        'SELECT id FROM inventory_items WHERE sku = $1',
        [input.sku],
      );
      const item = inventory.rows[0];
      if (!item) {
        this.logger.warn(`Cart "${cartId}" add failed because SKU "${input.sku}" was not found.`);
        throw new NotFoundException('SKU not found.');
      }

      await client.query(
        `
        INSERT INTO cart_items (cart_id, inventory_item_id, quantity)
        VALUES ($1, $2, $3)
        ON CONFLICT (cart_id, inventory_item_id)
        DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
        `,
        [cartId, item.id, input.quantity],
      );

      await this.clearReviewState(cartId, client);

      await this.auditService.write(
        {
          traceId,
          actorUserId: user.id,
          action: 'CART_ITEM_ADDED',
          entityType: 'cart',
          entityId: cartId,
          payload: {
            sku: input.sku,
            quantity: input.quantity,
          },
        },
        client,
      );

      const computation = await this.computeCart(cartId, client);
      return this.buildSummary(cartId, computation, null);
    });
  }

  async updateItem(
    user: SessionUser,
    traceId: string,
    cartId: string,
    cartItemId: string,
    input: UpdateCartItemDto,
  ) {
    return this.databaseService.withTransaction(async (client) => {
      await this.ensureCartItem(user.id, cartId, cartItemId, client, {
        lockCartForUpdate: true,
      });

      await client.query(
        `
        UPDATE cart_items
        SET quantity = $3
        WHERE id = $1 AND cart_id = $2
        `,
        [cartItemId, cartId, input.quantity],
      );

      await this.clearReviewState(cartId, client);
      await this.auditService.write(
        {
          traceId,
          actorUserId: user.id,
          action: 'CART_ITEM_UPDATED',
          entityType: 'cart',
          entityId: cartId,
          payload: {
            cartItemId,
            quantity: input.quantity,
          },
        },
        client,
      );

      const computation = await this.computeCart(cartId, client);
      return this.buildSummary(cartId, computation, null);
    });
  }

  async deleteItem(user: SessionUser, traceId: string, cartId: string, cartItemId: string) {
    return this.databaseService.withTransaction(async (client) => {
      await this.ensureCartItem(user.id, cartId, cartItemId, client, {
        lockCartForUpdate: true,
      });

      await client.query('DELETE FROM cart_items WHERE id = $1 AND cart_id = $2', [cartItemId, cartId]);
      await this.clearReviewState(cartId, client);
      await this.auditService.write(
        {
          traceId,
          actorUserId: user.id,
          action: 'CART_ITEM_REMOVED',
          entityType: 'cart',
          entityId: cartId,
          payload: {
            cartItemId,
          },
        },
        client,
      );

      const computation = await this.computeCart(cartId, client);
      return this.buildSummary(cartId, computation, null);
    });
  }

  async reviewTotal(user: SessionUser, traceId: string, cartId: string) {
    return this.databaseService.withTransaction(async (client) => {
      await this.ensureOpenCart(user.id, cartId, client, { lockForUpdate: true });
      const computation = await this.computeCart(cartId, client, { lockRows: true });
      if (!computation.lines.length) {
        throw new ConflictException('Cart is empty.');
      }
      if (computation.stockIssues.length) {
        throw new ConflictException({
          message: 'Inventory changed before review confirmation.',
          stockIssues: computation.stockIssues,
        });
      }

      const reviewed = await client.query<{ reviewed_at: string }>(
        `
        UPDATE carts
        SET review_signature = $2,
            reviewed_at = NOW(),
            reviewed_total_cents = $3,
            review_snapshot = $4::jsonb
        WHERE id = $1
        RETURNING reviewed_at
        `,
        [
          cartId,
          computation.reviewSignature,
          computation.totalCents,
          JSON.stringify(computation.reviewSnapshot),
        ],
      );

      const reviewedAt = reviewed.rows[0]!.reviewed_at;

      await this.auditService.write(
        {
          traceId,
          actorUserId: user.id,
          action: 'CART_REVIEWED',
          entityType: 'cart',
          entityId: cartId,
          payload: {
            total: computation.totalCents / 100,
            reviewSignature: computation.reviewSignature,
          },
        },
        client,
      );

      return this.buildSummary(cartId, computation, reviewedAt);
    });
  }

  async checkout(user: SessionUser, traceId: string, cartId: string, input: CheckoutDto) {
    return this.databaseService.withTransaction(async (client) => {
      const cart = await client.query<{
        status: string;
        review_signature: string | null;
        reviewed_total_cents: number | null;
      }>(
        `
        SELECT status, review_signature, reviewed_total_cents
        FROM carts
        WHERE id = $1 AND clerk_user_id = $2
        FOR UPDATE
        `,
        [cartId, user.id],
      );

      const cartRow = cart.rows[0];
      if (!cartRow) {
        throw new NotFoundException('Cart not found.');
      }
      if (cartRow.status !== 'OPEN') {
        throw new ConflictException('Only open carts can be checked out.');
      }
      if (!cartRow.review_signature || cartRow.reviewed_total_cents === null) {
        this.logger.warn(`Checkout blocked for cart "${cartId}" because no fresh review exists.`);
        throw new ConflictException('Review total must be completed before checkout.');
      }

      const computation = await this.computeCart(cartId, client, { lockRows: true });
      if (!computation.lines.length) {
        throw new ConflictException('Cart is empty.');
      }

      if (computation.stockIssues.length) {
        throw new ConflictException({
          message: 'Inventory changed since the last review. Review total again before checkout.',
          stockIssues: computation.stockIssues,
        });
      }

      if (
        cartRow.review_signature !== computation.reviewSignature ||
        cartRow.reviewed_total_cents !== computation.totalCents
      ) {
        this.logger.warn(`Checkout blocked for cart "${cartId}" because the review snapshot became stale.`);
        throw new ConflictException({
          message: 'The cart changed after review. Run review total again before checkout.',
          reviewedTotal: cartRow.reviewed_total_cents / 100,
          currentTotal: computation.totalCents / 100,
        });
      }

      const paymentNoteCipher = this.securityService.encryptAtRest(input.paymentNote ?? '');

      const order = await client.query<{ id: string }>(
        `
        INSERT INTO orders (cart_id, clerk_user_id, payment_method, payment_note_cipher, subtotal_cents, discount_cents, fee_cents, total_cents)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
        `,
        [
          cartId,
          user.id,
          input.paymentMethod,
          paymentNoteCipher,
          computation.subtotalCents,
          computation.discountCents,
          computation.feeCents,
          computation.totalCents,
        ],
      );

      for (const line of computation.lines) {
        await client.query(
          `
          INSERT INTO order_items (order_id, inventory_item_id, quantity, unit_price_cents, unit_cost_cents)
          VALUES ($1, $2, $3, $4, $5)
          `,
          [
            order.rows[0]!.id,
            line.inventory_item_id,
            line.quantity,
            line.price_cents,
            line.moving_average_cost_cents,
          ],
        );

        await client.query(
          'UPDATE inventory_items SET on_hand = on_hand - $2 WHERE id = $1',
          [line.inventory_item_id, line.quantity],
        );
      }

      await client.query('UPDATE carts SET status = $2 WHERE id = $1', [cartId, 'CHECKED_OUT']);
      await this.auditService.write(
        {
          traceId,
          actorUserId: user.id,
          action: 'CHECKOUT_COMPLETED',
          entityType: 'order',
          entityId: order.rows[0]!.id,
          payload: {
            cartId,
            totalCents: computation.totalCents,
            paymentMethod: input.paymentMethod,
            reviewSignature: computation.reviewSignature,
          },
        },
        client,
      );

      this.logger.log(`Checkout completed for cart "${cartId}" and order "${order.rows[0]!.id}".`);

      return {
        orderId: order.rows[0]!.id,
        total: computation.totalCents / 100,
      };
    });
  }
}
