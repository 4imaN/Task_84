import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SessionUser } from '@ledgerread/contracts';
import { AuthGuard } from '../auth/auth.guard';
import { AllowedRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentTraceId, CurrentUser } from '../common/current-user.decorator';
import { AdminService } from './admin.service';
import {
  GetAuditLogsQueryDto,
  ImportManifestDto,
  UpdateDiscrepancyStatusDto,
  UpdatePaymentPlanStatusDto,
} from './dto/admin.dto';

@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@AllowedRoles('MANAGER', 'FINANCE', 'INVENTORY_MANAGER')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('manifests/import')
  @AllowedRoles('MANAGER', 'INVENTORY_MANAGER')
  importManifest(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Body() body: ImportManifestDto,
  ) {
    return this.adminService.importManifest(user, traceId, body);
  }

  @Get('settlements')
  getSettlements(@Query('status') status?: string) {
    return this.adminService.getSettlements(status);
  }

  @Patch('payment-plans/:paymentPlanId/status')
  @AllowedRoles('MANAGER', 'FINANCE')
  updatePaymentPlanStatus(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Param('paymentPlanId', new ParseUUIDPipe()) paymentPlanId: string,
    @Body() body: UpdatePaymentPlanStatusDto,
  ) {
    return this.adminService.updatePaymentPlanStatus(user, traceId, paymentPlanId, body);
  }

  @Patch('discrepancies/:discrepancyId/status')
  @AllowedRoles('MANAGER', 'INVENTORY_MANAGER')
  updateDiscrepancyStatus(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Param('discrepancyId', new ParseUUIDPipe()) discrepancyId: string,
    @Body() body: UpdateDiscrepancyStatusDto,
  ) {
    return this.adminService.updateDiscrepancyStatus(user, traceId, discrepancyId, body);
  }

  @Get('audit-logs')
  getAuditLogs(@CurrentUser() user: SessionUser, @Query() query: GetAuditLogsQueryDto) {
    return this.adminService.getAuditLogs(user, query.limit, query.action);
  }

  @Get('audit-integrity')
  getAuditIntegrity() {
    return this.adminService.getAuditIntegrity();
  }
}
