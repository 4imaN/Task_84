import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ledgerread/contracts';
import { AuthGuard } from '../auth/auth.guard';
import { AllowedRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentTraceId, CurrentUser } from '../common/current-user.decorator';
import { CommunityService } from './community.service';
import {
  CreateCommentDto,
  CreateReportDto,
  FavoriteDto,
  RatingDto,
  RelationshipDto,
  SubscribeDto,
} from './dto/community.dto';

@Controller('community')
@UseGuards(AuthGuard, RolesGuard)
@AllowedRoles('CUSTOMER')
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Post('comments')
  createComment(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Body() body: CreateCommentDto,
  ) {
    return this.communityService.createComment(user, traceId, body);
  }

  @Post('reports')
  createReport(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Body() body: CreateReportDto,
  ) {
    return this.communityService.createReport(user, traceId, body);
  }

  @Post('relationships/block')
  block(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Body() body: RelationshipDto,
  ) {
    return this.communityService.updateBlock(user, traceId, body);
  }

  @Post('relationships/mute')
  mute(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Body() body: RelationshipDto,
  ) {
    return this.communityService.updateMute(user, traceId, body);
  }

  @Post('ratings')
  rate(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Body() body: RatingDto,
  ) {
    return this.communityService.upsertRating(user, traceId, body);
  }

  @Post('favorites')
  favorite(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Body() body: FavoriteDto,
  ) {
    return this.communityService.updateFavorite(user, traceId, body);
  }

  @Post('subscriptions/authors')
  subscribeAuthor(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Body() body: SubscribeDto,
  ) {
    return this.communityService.updateAuthorSubscription(user, traceId, body);
  }

  @Post('subscriptions/series')
  subscribeSeries(
    @CurrentUser() user: SessionUser,
    @CurrentTraceId() traceId: string,
    @Body() body: SubscribeDto,
  ) {
    return this.communityService.updateSeriesSubscription(user, traceId, body);
  }
}
