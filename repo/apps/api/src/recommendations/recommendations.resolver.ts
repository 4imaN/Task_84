import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { AllowedRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentTraceId } from '../common/current-user.decorator';
import { graphQlUuidPipe } from '../common/graphql-uuid.pipe';
import { RecommendationModel } from '../graphql/models';
import { RecommendationsService } from './recommendations.service';

@Resolver()
@UseGuards(AuthGuard, RolesGuard)
export class RecommendationsResolver {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Query(() => RecommendationModel)
  @AllowedRoles('CUSTOMER')
  recommendations(
    @Args('titleId', graphQlUuidPipe) titleId: string,
    @CurrentTraceId() traceId: string,
  ) {
    return this.recommendationsService.getRecommendations(titleId, traceId);
  }
}
