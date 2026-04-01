import { Body, Controller, Get, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { SessionUser } from '@ledgerread/contracts';
import { AuthGuard } from '../auth/auth.guard';
import { AllowedRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentTraceId, CurrentUser } from '../common/current-user.decorator';
import { AttendanceDto } from './dto/attendance.dto';
import { AttendanceService, type UploadedEvidenceFile } from './attendance.service';

@Controller('attendance')
@UseGuards(AuthGuard, RolesGuard)
@AllowedRoles('CLERK', 'MODERATOR', 'MANAGER', 'FINANCE', 'INVENTORY_MANAGER')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('clock-in')
  @UseInterceptors(FileInterceptor('evidence'))
  clockIn(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Body() body: AttendanceDto,
    @UploadedFile() file?: UploadedEvidenceFile,
  ) {
    return this.attendanceService.clockIn(user, traceId, body, file);
  }

  @Post('clock-out')
  @UseInterceptors(FileInterceptor('evidence'))
  clockOut(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Body() body: AttendanceDto,
    @UploadedFile() file?: UploadedEvidenceFile,
  ) {
    return this.attendanceService.clockOut(user, traceId, body, file);
  }

  @Get('risks')
  getRisks(@CurrentUser() user: SessionUser) {
    return this.attendanceService.getRiskAlerts(user);
  }
}
