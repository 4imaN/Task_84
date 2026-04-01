import { Body, Controller, Get, Put, Post, UseGuards } from '@nestjs/common';
import { CurrentTraceId, CurrentUser } from '../common/current-user.decorator';
import type { SessionUser } from '@ledgerread/contracts';
import { AuthGuard } from '../auth/auth.guard';
import { AllowedRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ProfilesService } from './profiles.service';
import { SyncReadingProfileDto, UpsertReadingProfileDto } from './dto/reading-preferences.dto';

@Controller('profiles')
@UseGuards(AuthGuard, RolesGuard)
@AllowedRoles('CUSTOMER')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get('me')
  getMine(@CurrentUser() user: SessionUser) {
    return this.profilesService.getMine(user.id);
  }

  @Put('me')
  updateMine(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Body() body: UpsertReadingProfileDto,
  ) {
    return this.profilesService.updateMine(user, traceId, body);
  }

  @Post('me/sync')
  syncMine(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Body() body: SyncReadingProfileDto,
  ) {
    return this.profilesService.syncMine(user, traceId, body);
  }
}
