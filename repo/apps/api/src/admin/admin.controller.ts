import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ledgerread/contracts';
import { AuthGuard } from '../auth/auth.guard';
import { AllowedRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentTraceId, CurrentUser } from '../common/current-user.decorator';
import { AdminService } from './admin.service';
import { ImportManifestDto } from './dto/admin.dto';

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

  @Get('audit-logs')
  getAuditLogs(@Query('limit') limit?: string, @Query('action') action?: string) {
    return this.adminService.getAuditLogs(limit ? Number(limit) : undefined, action);
  }
}
