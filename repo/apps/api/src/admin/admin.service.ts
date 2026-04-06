import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { SessionUser } from '@ledgerread/contracts';
import { AuditService } from '../audit/audit.service';
import { AttendanceService } from '../attendance/attendance.service';
import { DatabaseService } from '../database/database.service';
import { SecurityService } from '../security/security.service';
import type {
  ImportManifestDto,
  ManifestItemDto,
  UpdateDiscrepancyStatusDto,
  UpdatePaymentPlanStatusDto,
} from './dto/admin.dto';

type PaymentPlanStatus = 'PENDING' | 'MATCHED' | 'PARTIAL' | 'PAID' | 'DISPUTED';
type DiscrepancyStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'WAIVED';

const PAYMENT_PLAN_TRANSITIONS: Record<PaymentPlanStatus, PaymentPlanStatus[]> = {
  PENDING: ['MATCHED', 'PARTIAL', 'DISPUTED'],
  MATCHED: ['PARTIAL', 'PAID', 'DISPUTED'],
  PARTIAL: ['PAID', 'DISPUTED'],
  PAID: [],
  DISPUTED: ['PENDING', 'MATCHED', 'PARTIAL'],
};

const DISCREPANCY_TRANSITIONS: Record<DiscrepancyStatus, DiscrepancyStatus[]> = {
  OPEN: ['UNDER_REVIEW', 'RESOLVED', 'WAIVED'],
  UNDER_REVIEW: ['OPEN', 'RESOLVED', 'WAIVED'],
  RESOLVED: ['OPEN'],
  WAIVED: ['OPEN'],
};

const SENSITIVE_AUDIT_KEY_PATTERN =
  /(signature|hash|cipher|token|password|secret|note|notes|body|fingerprint)/i;
const BASE_VISIBLE_AUDIT_KEY_PATTERN =
  /(Id|At|sku|quantity|availableQuantity|requestedQuantity|rating|active|category|commentType|paymentMethod|deviceLabel|resolution|status|total|subtotal|discount|fee|price|amount|method)/i;
const FINANCE_VISIBLE_AUDIT_KEY_PATTERN =
  /(Id|At|sku|quantity|availableQuantity|requestedQuantity|paymentMethod|resolution|status|total|subtotal|discount|fee|price|amount|method)/i;

interface InventoryValuationRow {
  id: string;
  on_hand: number;
  moving_average_cost_cents: number;
}

interface PaymentPlanRow {
  id: string;
  supplier_name: string;
  status: PaymentPlanStatus;
  created_at: string;
  updated_at: string;
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
  status: DiscrepancyStatus;
  created_at: string;
  updated_at: string;
  statement_reference: string | null;
  invoice_reference: string | null;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly attendanceService: AttendanceService,
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

  private getAllowedPaymentPlanTransitions(status: PaymentPlanStatus) {
    return PAYMENT_PLAN_TRANSITIONS[status] ?? [];
  }

  private getAllowedDiscrepancyTransitions(status: DiscrepancyStatus) {
    return DISCREPANCY_TRANSITIONS[status] ?? [];
  }

  private isDateLikeAuditKey(key: string) {
    return /(At|Date|Timestamp)$/i.test(key) || key.endsWith('_at');
  }

  private projectAuditPayload(
    payload: Record<string, unknown>,
    role: SessionUser['role'],
  ): { payload: Record<string, string | number | boolean | null>; redactedFields: number } {
    const visiblePayload: Record<string, string | number | boolean | null> = {};
    let redactedFields = 0;
    const rolePattern = role === 'FINANCE' ? FINANCE_VISIBLE_AUDIT_KEY_PATTERN : BASE_VISIBLE_AUDIT_KEY_PATTERN;

    for (const [key, value] of Object.entries(payload)) {
      if (SENSITIVE_AUDIT_KEY_PATTERN.test(key)) {
        redactedFields += 1;
        continue;
      }
      if (!rolePattern.test(key) && !this.isDateLikeAuditKey(key)) {
        redactedFields += 1;
        continue;
      }

      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        visiblePayload[key] = value as string | number | boolean | null;
        continue;
      }

      redactedFields += 1;
    }

    return {
      payload: visiblePayload,
      redactedFields,
    };
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
             payment_plans.updated_at,
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
               payment_plans.updated_at,
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
             reconciliation_discrepancies.updated_at,
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
        allowedTransitions: this.getAllowedPaymentPlanTransitions(row.status),
      })),
      discrepancies: discrepancies.rows.map((row) => ({
        ...row,
        amountDifference: row.amount_difference_cents / 100,
        allowedTransitions: this.getAllowedDiscrepancyTransitions(row.status),
      })),
    };
  }

  async updatePaymentPlanStatus(
    user: SessionUser,
    traceId: string,
    paymentPlanId: string,
    input: UpdatePaymentPlanStatusDto,
  ) {
    return this.databaseService.withTransaction(async (client) => {
      const paymentPlan = await client.query<{
        id: string;
        supplier_name: string;
        status: PaymentPlanStatus;
        updated_at: string;
        statement_reference: string | null;
        invoice_reference: string | null;
      }>(
        `
        SELECT payment_plans.id,
               payment_plans.supplier_name,
               payment_plans.status,
               payment_plans.updated_at,
               supplier_statements.statement_reference,
               supplier_invoices.invoice_reference
        FROM payment_plans
        LEFT JOIN supplier_statements ON supplier_statements.id = payment_plans.supplier_statement_id
        LEFT JOIN supplier_invoices ON supplier_invoices.id = payment_plans.supplier_invoice_id
        WHERE payment_plans.id = $1
        FOR UPDATE OF payment_plans
        `,
        [paymentPlanId],
      );

      const current = paymentPlan.rows[0];
      if (!current) {
        throw new NotFoundException('Payment plan not found.');
      }

      if (current.status === input.status) {
        return {
          id: current.id,
          status: current.status,
          updatedAt: current.updated_at,
        };
      }

      const allowedTransitions = this.getAllowedPaymentPlanTransitions(current.status);
      if (!allowedTransitions.includes(input.status)) {
        throw new ConflictException(
          `Payment plan status cannot transition from ${current.status} to ${input.status}.`,
        );
      }

      const updated = await client.query<{ id: string; status: PaymentPlanStatus; updated_at: string }>(
        `
        UPDATE payment_plans
        SET status = $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, status, updated_at
        `,
        [paymentPlanId, input.status],
      );

      await this.auditService.write(
        {
          traceId,
          actorUserId: user.id,
          action: 'PAYMENT_PLAN_STATUS_UPDATED',
          entityType: 'payment_plan',
          entityId: current.id,
          payload: {
            previousStatus: current.status,
            status: input.status,
            supplierName: current.supplier_name,
            statementReference: current.statement_reference,
            invoiceReference: current.invoice_reference,
          },
        },
        client,
      );

      return {
        id: updated.rows[0]!.id,
        status: updated.rows[0]!.status,
        updatedAt: updated.rows[0]!.updated_at,
      };
    });
  }

  async updateDiscrepancyStatus(
    user: SessionUser,
    traceId: string,
    discrepancyId: string,
    input: UpdateDiscrepancyStatusDto,
  ) {
    return this.databaseService.withTransaction(async (client) => {
      const discrepancy = await client.query<{
        id: string;
        sku: string;
        status: DiscrepancyStatus;
        updated_at: string;
        statement_reference: string | null;
        invoice_reference: string | null;
      }>(
        `
        SELECT reconciliation_discrepancies.id,
               reconciliation_discrepancies.sku,
               reconciliation_discrepancies.status,
               reconciliation_discrepancies.updated_at,
               supplier_statements.statement_reference,
               supplier_invoices.invoice_reference
        FROM reconciliation_discrepancies
        JOIN supplier_statements
          ON supplier_statements.id = reconciliation_discrepancies.supplier_statement_id
        JOIN supplier_invoices
          ON supplier_invoices.id = reconciliation_discrepancies.supplier_invoice_id
        WHERE reconciliation_discrepancies.id = $1
        FOR UPDATE OF reconciliation_discrepancies
        `,
        [discrepancyId],
      );

      const current = discrepancy.rows[0];
      if (!current) {
        throw new NotFoundException('Reconciliation discrepancy not found.');
      }

      if (current.status === input.status) {
        return {
          id: current.id,
          status: current.status,
          updatedAt: current.updated_at,
        };
      }

      const allowedTransitions = this.getAllowedDiscrepancyTransitions(current.status);
      if (!allowedTransitions.includes(input.status)) {
        throw new ConflictException(
          `Reconciliation discrepancy cannot transition from ${current.status} to ${input.status}.`,
        );
      }

      const updated = await client.query<{ id: string; status: DiscrepancyStatus; updated_at: string }>(
        `
        UPDATE reconciliation_discrepancies
        SET status = $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, status, updated_at
        `,
        [discrepancyId, input.status],
      );

      await this.auditService.write(
        {
          traceId,
          actorUserId: user.id,
          action: 'RECONCILIATION_DISCREPANCY_STATUS_UPDATED',
          entityType: 'reconciliation_discrepancy',
          entityId: current.id,
          payload: {
            previousStatus: current.status,
            status: input.status,
            sku: current.sku,
            statementReference: current.statement_reference,
            invoiceReference: current.invoice_reference,
          },
        },
        client,
      );

      return {
        id: updated.rows[0]!.id,
        status: updated.rows[0]!.status,
        updatedAt: updated.rows[0]!.updated_at,
      };
    });
  }

  async getAuditLogs(user: SessionUser, limit?: number, action?: string) {
    const result = await this.databaseService.query<{
      id: string;
      trace_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      payload: Record<string, unknown>;
      created_at: string;
    }>(
      `
      SELECT id, trace_id, action, entity_type, entity_id, payload, created_at
      FROM audit_logs
      WHERE ($1::text IS NULL OR action = $1)
      ORDER BY created_at DESC, id DESC
      LIMIT $2
      `,
      [action ?? null, limit ?? 20],
    );

    return result.rows.map((row) => {
      const projected = this.projectAuditPayload(row.payload ?? {}, user.role);
      return {
        ...row,
        payload: projected.payload,
        redacted_fields: projected.redactedFields,
      };
    });
  }

  async getAuditIntegrity() {
    const [auditLogs, attendanceRecords] = await Promise.all([
      this.auditService.verifyIntegrity(),
      this.attendanceService.verifyIntegrity(),
    ]);

    return {
      auditLogs,
      attendanceRecords,
    };
  }
}
