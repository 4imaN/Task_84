import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '@ledgerread/contracts';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import { SecurityService } from '../security/security.service';
import type { ImportManifestDto, ManifestItemDto } from './dto/admin.dto';

interface InventoryValuationRow {
  id: string;
  on_hand: number;
  moving_average_cost_cents: number;
}

interface PaymentPlanRow {
  id: string;
  supplier_name: string;
  status: string;
  created_at: string;
  statement_reference: string | null;
  invoice_reference: string | null;
  freight_cents: number | null;
  surcharge_cents: number | null;
  invoice_amount_cents: string;
  landed_cost_cents: string;
}

interface DiscrepancyRow {
  id: string;
  sku: string;
  quantity_difference: number;
  amount_difference_cents: number;
  status: string;
  created_at: string;
  statement_reference: string | null;
  invoice_reference: string | null;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly securityService: SecurityService,
  ) {}

  private allocateLandedCosts(items: ManifestItemDto[], totalLandedCostCents: number) {
    if (items.length === 0 || totalLandedCostCents === 0) {
      return items.map(() => 0);
    }

    const basisValues = items.map((item) => Math.max(item.invoiceExtendedAmountCents, item.invoiceQuantity, 1));
    const basisTotal = basisValues.reduce((sum, value) => sum + value, 0);
    let remaining = totalLandedCostCents;

    return items.map((_, index) => {
      if (index === items.length - 1) {
        return remaining;
      }

      const share = Math.floor((totalLandedCostCents * basisValues[index]!) / basisTotal);
      remaining -= share;
      return share;
    });
  }

  private computeMovingAverageCost(
    previousOnHand: number,
    previousAverageCostCents: number,
    receivedQuantity: number,
    receivedTotalCostCents: number,
  ) {
    const resultingOnHand = previousOnHand + receivedQuantity;
    if (resultingOnHand <= 0) {
      return 0;
    }

    return Math.round(
      (previousOnHand * previousAverageCostCents + receivedTotalCostCents) / resultingOnHand,
    );
  }

  async importManifest(user: SessionUser, traceId: string, input: ImportManifestDto) {
    return this.databaseService.withTransaction(async (client) => {
      const statement = await client.query<{ id: string }>(
        `
        INSERT INTO supplier_statements (uploaded_by_user_id, supplier_name, statement_reference, source_filename)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        `,
        [user.id, input.supplierName, input.statementReference, input.sourceFilename],
      );

      const statementId = statement.rows[0]!.id;
      const invoice = await client.query<{ id: string }>(
        `
        INSERT INTO supplier_invoices (statement_id, invoice_reference, freight_cents, surcharge_cents, status)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        `,
        [
          statementId,
          input.invoiceReference,
          input.freightCents,
          input.surchargeCents,
          input.paymentPlanStatus,
        ],
      );
      const invoiceId = invoice.rows[0]!.id;

      const landedAllocations = this.allocateLandedCosts(
        input.items,
        input.freightCents + input.surchargeCents,
      );

      let discrepancyCount = 0;
      let totalReceivedUnits = 0;

      for (const [index, item] of input.items.entries()) {
        const inventory = await client.query<InventoryValuationRow>(
          `
          SELECT id, on_hand, moving_average_cost_cents
          FROM inventory_items
          WHERE sku = $1
          FOR UPDATE
          `,
          [item.sku],
        );
        const current = inventory.rows[0];
        if (!current) {
          throw new NotFoundException(`Inventory item ${item.sku} was not found for reconciliation.`);
        }

        const statementLine = await client.query<{ id: string }>(
          `
          INSERT INTO supplier_statement_lines (statement_id, sku, statement_quantity, statement_extended_amount_cents)
          VALUES ($1, $2, $3, $4)
          RETURNING id
          `,
          [statementId, item.sku, item.statementQuantity, item.statementExtendedAmountCents],
        );

        const landedCostAllocationCents = landedAllocations[index] ?? 0;
        const unitCostCents =
          item.invoiceQuantity > 0 ? Math.round(item.invoiceExtendedAmountCents / item.invoiceQuantity) : 0;

        const invoiceLine = await client.query<{ id: string }>(
          `
          INSERT INTO supplier_invoice_lines (
            invoice_id,
            statement_line_id,
            sku,
            invoice_quantity,
            invoice_extended_amount_cents,
            unit_cost_cents,
            landed_cost_allocation_cents
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
          `,
          [
            invoiceId,
            statementLine.rows[0]!.id,
            item.sku,
            item.invoiceQuantity,
            item.invoiceExtendedAmountCents,
            unitCostCents,
            landedCostAllocationCents,
          ],
        );

        const quantityDifference = Math.abs(item.statementQuantity - item.invoiceQuantity);
        const amountDifference = Math.abs(
          item.statementExtendedAmountCents - item.invoiceExtendedAmountCents,
        );

        if (quantityDifference >= 2 || amountDifference > 500) {
          discrepancyCount += 1;
          await client.query(
            `
            INSERT INTO reconciliation_discrepancies (
              supplier_statement_id,
              supplier_invoice_id,
              supplier_statement_line_id,
              supplier_invoice_line_id,
              sku,
              quantity_difference,
              amount_difference_cents
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            `,
            [
              statementId,
              invoiceId,
              statementLine.rows[0]!.id,
              invoiceLine.rows[0]!.id,
              item.sku,
              quantityDifference,
              amountDifference,
            ],
          );
        }

        if (item.invoiceQuantity > 0) {
          const receivedTotalCostCents = item.invoiceExtendedAmountCents + landedCostAllocationCents;
          const resultingOnHand = current.on_hand + item.invoiceQuantity;
          const resultingMovingAverageCostCents = this.computeMovingAverageCost(
            current.on_hand,
            current.moving_average_cost_cents,
            item.invoiceQuantity,
            receivedTotalCostCents,
          );

          await client.query(
            `
            UPDATE inventory_items
            SET on_hand = $2,
                moving_average_cost_cents = $3
            WHERE id = $1
            `,
            [current.id, resultingOnHand, resultingMovingAverageCostCents],
          );

          await client.query(
            `
            INSERT INTO inventory_receipts (
              invoice_id,
              inventory_item_id,
              supplier_invoice_line_id,
              quantity_received,
              base_cost_cents,
              landed_cost_cents,
              previous_on_hand,
              previous_moving_average_cost_cents,
              resulting_on_hand,
              resulting_moving_average_cost_cents
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `,
            [
              invoiceId,
              current.id,
              invoiceLine.rows[0]!.id,
              item.invoiceQuantity,
              item.invoiceExtendedAmountCents,
              landedCostAllocationCents,
              current.on_hand,
              current.moving_average_cost_cents,
              resultingOnHand,
              resultingMovingAverageCostCents,
            ],
          );

          totalReceivedUnits += item.invoiceQuantity;
        }
      }

      const planNote = `Statement ${input.statementReference} matched to invoice ${input.invoiceReference}. Freight ${input.freightCents} cents, surcharge ${input.surchargeCents} cents.`;
      const paymentPlan = await client.query<{ id: string }>(
        `
        INSERT INTO payment_plans (
          supplier_name,
          status,
          note_cipher,
          supplier_statement_id,
          supplier_invoice_id,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id
        `,
        [
          input.supplierName,
          input.paymentPlanStatus,
          this.securityService.encryptAtRest(planNote),
          statementId,
          invoiceId,
        ],
      );

      await this.auditService.write(
        {
          traceId,
          actorUserId: user.id,
          action: 'MANIFEST_IMPORTED',
          entityType: 'supplier_statement',
          entityId: statementId,
          payload: {
            supplierName: input.supplierName,
            statementReference: input.statementReference,
            invoiceReference: input.invoiceReference,
            itemCount: input.items.length,
            totalReceivedUnits,
            discrepancyCount,
            landedCostCents: input.freightCents + input.surchargeCents,
            paymentPlanId: paymentPlan.rows[0]!.id,
          },
        },
        client,
      );

      this.logger.log(
        `Manifest imported for supplier "${input.supplierName}" with ${input.items.length} lines and ${discrepancyCount} discrepancies.`,
      );

      return {
        manifestId: statementId,
        statementId,
        invoiceId,
        discrepancyCount,
      };
    });
  }

  async getSettlements(status?: string) {
    const paymentPlans = await this.databaseService.query<PaymentPlanRow>(
      `
      SELECT payment_plans.id,
             payment_plans.supplier_name,
             payment_plans.status,
             payment_plans.created_at,
             supplier_statements.statement_reference,
             supplier_invoices.invoice_reference,
             supplier_invoices.freight_cents,
             supplier_invoices.surcharge_cents,
             COALESCE(SUM(supplier_invoice_lines.invoice_extended_amount_cents), 0)::text AS invoice_amount_cents,
             COALESCE(SUM(supplier_invoice_lines.landed_cost_allocation_cents), 0)::text AS landed_cost_cents
      FROM payment_plans
      LEFT JOIN supplier_statements ON supplier_statements.id = payment_plans.supplier_statement_id
      LEFT JOIN supplier_invoices ON supplier_invoices.id = payment_plans.supplier_invoice_id
      LEFT JOIN supplier_invoice_lines ON supplier_invoice_lines.invoice_id = supplier_invoices.id
      WHERE ($1::text IS NULL OR payment_plans.status = $1)
      GROUP BY payment_plans.id,
               payment_plans.supplier_name,
               payment_plans.status,
               payment_plans.created_at,
               supplier_statements.statement_reference,
               supplier_invoices.invoice_reference,
               supplier_invoices.freight_cents,
               supplier_invoices.surcharge_cents
      ORDER BY payment_plans.created_at DESC
      `,
      [status ?? null],
    );
    const discrepancies = await this.databaseService.query<DiscrepancyRow>(
      `
      SELECT reconciliation_discrepancies.id,
             reconciliation_discrepancies.sku,
             reconciliation_discrepancies.quantity_difference,
             reconciliation_discrepancies.amount_difference_cents,
             reconciliation_discrepancies.status,
             reconciliation_discrepancies.created_at,
             supplier_statements.statement_reference,
             supplier_invoices.invoice_reference
      FROM reconciliation_discrepancies
      JOIN supplier_statements
        ON supplier_statements.id = reconciliation_discrepancies.supplier_statement_id
      JOIN supplier_invoices
        ON supplier_invoices.id = reconciliation_discrepancies.supplier_invoice_id
      ORDER BY reconciliation_discrepancies.created_at DESC
      `,
    );

    return {
      paymentPlans: paymentPlans.rows.map((row) => ({
        ...row,
        invoiceAmount: Number(row.invoice_amount_cents) / 100,
        landedCost: Number(row.landed_cost_cents) / 100,
      })),
      discrepancies: discrepancies.rows.map((row) => ({
        ...row,
        amountDifference: row.amount_difference_cents / 100,
      })),
    };
  }

  async getAuditLogs(limit?: number, action?: string) {
    const result = await this.databaseService.query<{
      id: string;
      trace_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      payload: Record<string, unknown>;
      previous_hash: string | null;
      current_hash: string;
      created_at: string;
    }>(
      `
      SELECT id, trace_id, action, entity_type, entity_id, payload, previous_hash, current_hash, created_at
      FROM audit_logs
      WHERE ($1::text IS NULL OR action = $1)
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [action ?? null, limit ?? 20],
    );

    return result.rows;
  }
}
