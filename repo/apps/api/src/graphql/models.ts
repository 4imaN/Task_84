import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class ChapterModel {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  order!: number;

  @Field()
  name!: string;

  @Field()
  body!: string;

  @Field()
  bodySimplified!: string;

  @Field()
  bodyTraditional!: string;
}

@ObjectType()
export class ReadingPreferencesModel {
  @Field()
  fontFamily!: string;

  @Field(() => Int)
  fontSize!: number;

  @Field(() => Float)
  lineSpacing!: number;

  @Field()
  readerMode!: string;

  @Field()
  theme!: string;

  @Field()
  nightMode!: boolean;

  @Field()
  chineseMode!: string;

  @Field()
  updatedAt!: string;
}

@ObjectType()
export class TitleSummaryModel {
  @Field(() => ID)
  id!: string;

  @Field()
  slug!: string;

  @Field()
  name!: string;

  @Field()
  format!: string;

  @Field(() => Float)
  price!: number;

  @Field(() => Int)
  inventoryOnHand!: number;

  @Field()
  authorName!: string;

  @Field(() => ID)
  authorId!: string;

  @Field({ nullable: true })
  seriesName?: string;

  @Field(() => ID, { nullable: true })
  seriesId?: string;
}

@ObjectType()
export class CatalogModel {
  @Field(() => [TitleSummaryModel])
  featured!: TitleSummaryModel[];

  @Field(() => [TitleSummaryModel])
  bestSellers!: TitleSummaryModel[];
}

@ObjectType()
export class TitleDetailModel extends TitleSummaryModel {
  @Field(() => [ChapterModel])
  chapters!: ChapterModel[];

  @Field(() => ReadingPreferencesModel)
  readingPreferences!: ReadingPreferencesModel;

  @Field(() => Float)
  averageRating!: number;
}

@ObjectType()
export class CommunityCommentModel {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  authorId!: string;

  @Field()
  authorName!: string;

  @Field()
  commentType!: string;

  @Field()
  visibleBody!: string;

  @Field()
  createdAt!: string;

  @Field(() => [CommunityCommentModel])
  replies!: CommunityCommentModel[];
}

@ObjectType()
export class CommunityThreadModel {
  @Field(() => ID)
  titleId!: string;

  @Field()
  viewerHasFavorited!: boolean;

  @Field()
  viewerFollowsAuthor!: boolean;

  @Field()
  viewerFollowsSeries!: boolean;

  @Field(() => [CommunityCommentModel])
  comments!: CommunityCommentModel[];

  @Field(() => Float)
  averageRating!: number;

  @Field(() => Int)
  totalRatings!: number;
}

@ObjectType()
export class RecommendationModel {
  @Field(() => ID)
  titleId!: string;

  @Field()
  reason!: string;

  @Field(() => [String])
  recommendedTitleIds!: string[];

  @Field()
  traceId!: string;
}
