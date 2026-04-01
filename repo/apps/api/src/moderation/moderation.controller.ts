import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ledgerread/contracts';
import { AuthGuard } from '../auth/auth.guard';
import { AllowedRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentTraceId, CurrentUser } from '../common/current-user.decorator';
import { ModerationActionDto } from './dto/moderation.dto';
import { ModerationService } from './moderation.service';

@Controller('moderation')
@UseGuards(AuthGuard, RolesGuard)
@AllowedRoles('MODERATOR')
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get('queue')
  getQueue(@Query('status') status?: string) {
    return this.moderationService.getQueue(status);
  }

  @Post('actions')
  applyAction(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Body() body: ModerationActionDto,
  ) {
    return this.moderationService.applyAction(user, traceId, body);
  }
}
