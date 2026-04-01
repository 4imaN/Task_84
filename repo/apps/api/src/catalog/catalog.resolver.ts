import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import type { SessionUser } from '@ledgerread/contracts';
import { AuthGuard } from '../auth/auth.guard';
import { AllowedRoles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { CatalogService } from './catalog.service';
import { CatalogModel, CommunityThreadModel, TitleDetailModel } from '../graphql/models';

@Resolver()
@UseGuards(AuthGuard, RolesGuard)
export class CatalogResolver {
  constructor(private readonly catalogService: CatalogService) {}

  @Query(() => CatalogModel)
  @AllowedRoles('CUSTOMER')
  catalog() {
    return this.catalogService.getCatalog();
  }

  @Query(() => TitleDetailModel)
  @AllowedRoles('CUSTOMER')
  title(@CurrentUser() user: SessionUser, @Args('id') id: string) {
    return this.catalogService.getTitle(user, id);
  }

  @Query(() => CommunityThreadModel)
  @AllowedRoles('CUSTOMER')
  communityThread(@CurrentUser() user: SessionUser, @Args('titleId') titleId: string) {
    return this.catalogService.getCommunityThread(user, titleId);
  }
}

