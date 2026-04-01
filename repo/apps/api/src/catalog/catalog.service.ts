import { Injectable, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '@ledgerread/contracts';
import { DatabaseService } from '../database/database.service';
import type {
  CatalogModel,
  ChapterModel,
  CommunityCommentModel,
  CommunityThreadModel,
  TitleDetailModel,
  TitleSummaryModel,
} from '../graphql/models';

interface TitleRow {
  id: string;
  slug: string;
  name: string;
  format: string;
  price_cents: number;
  inventory_on_hand: number;
  author_id: string;
  author_name: string;
  series_id: string | null;
  series_name: string | null;
}

const toIsoTimestamp = (value: unknown) => {
  const candidate =
    value instanceof Date
      ? value
      : typeof value === 'number'
        ? new Date(value)
        : typeof value === 'string' && /^\d+$/.test(value)
          ? new Date(value.length <= 10 ? Number(value) * 1000 : Number(value))
          : typeof value === 'string'
            ? new Date(value)
            : new Date();

  return Number.isNaN(candidate.getTime()) ? new Date().toISOString() : candidate.toISOString();
};

@Injectable()
export class CatalogService {
  constructor(private readonly databaseService: DatabaseService) {}

  private mapTitle(row: TitleRow): TitleSummaryModel {
    const base: TitleSummaryModel = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      format: row.format,
      price: row.price_cents / 100,
      inventoryOnHand: row.inventory_on_hand,
      authorName: row.author_name,
      authorId: row.author_id,
    };

    return row.series_name && row.series_id
      ? { ...base, seriesName: row.series_name, seriesId: row.series_id }
      : row.series_name
        ? { ...base, seriesName: row.series_name }
        : base;
  }

  async getCatalog(): Promise<CatalogModel> {
    const featured = await this.databaseService.query<TitleRow>(
      `
      SELECT titles.id,
             titles.slug,
             titles.name,
             titles.format,
             titles.price_cents,
             titles.inventory_on_hand,
             titles.author_id,
             titles.series_id,
             authors.name AS author_name,
             series.name AS series_name
      FROM titles
      JOIN authors ON authors.id = titles.author_id
      LEFT JOIN series ON series.id = titles.series_id
      ORDER BY titles.bestseller_rank ASC
      LIMIT 4
      `,
    );

    const bestSellers = await this.databaseService.query<TitleRow>(
      `
      SELECT titles.id,
             titles.slug,
             titles.name,
             titles.format,
             titles.price_cents,
             titles.inventory_on_hand,
             titles.author_id,
             titles.series_id,
             authors.name AS author_name,
             series.name AS series_name
      FROM titles
      JOIN authors ON authors.id = titles.author_id
      LEFT JOIN series ON series.id = titles.series_id
      ORDER BY titles.bestseller_rank ASC
      LIMIT 6
      `,
    );

    return {
      featured: featured.rows.map((row: TitleRow) => this.mapTitle(row)),
      bestSellers: bestSellers.rows.map((row: TitleRow) => this.mapTitle(row)),
    };
  }

  async getTitle(user: SessionUser, titleId: string): Promise<TitleDetailModel> {
    const title = await this.databaseService.query<TitleRow>(
      `
      SELECT titles.id,
             titles.slug,
             titles.name,
             titles.format,
             titles.price_cents,
             titles.inventory_on_hand,
             titles.author_id,
             titles.series_id,
             authors.name AS author_name,
             series.name AS series_name
      FROM titles
      JOIN authors ON authors.id = titles.author_id
      LEFT JOIN series ON series.id = titles.series_id
      WHERE titles.id = $1
      `,
      [titleId],
    );

    const titleRow = title.rows[0];
    if (!titleRow) {
      throw new NotFoundException('Title not found.');
    }

    const chapters = await this.databaseService.query<{
      id: string;
      chapter_order: number;
      name: string;
      body_simplified: string;
      body_traditional: string;
    }>(
      `
      SELECT id, chapter_order, name, body_simplified, body_traditional
      FROM chapters
      WHERE title_id = $1
      ORDER BY chapter_order ASC
      `,
      [titleId],
    );

    const profile = await this.databaseService.query<{
      preferences: {
        chineseMode: 'SIMPLIFIED' | 'TRADITIONAL';
        [key: string]: unknown;
      };
    }>('SELECT preferences FROM reading_profiles WHERE user_id = $1', [user.id]);

    const preferences = profile.rows[0]?.preferences;
    const chineseMode = preferences?.chineseMode ?? 'SIMPLIFIED';

    const ratings = await this.databaseService.query<{ average_rating: string | null }>(
      'SELECT ROUND(AVG(rating)::numeric, 2)::text AS average_rating FROM ratings WHERE title_id = $1',
      [titleId],
    );

    return {
      ...this.mapTitle(titleRow),
      chapters: chapters.rows.map<ChapterModel>((chapter: {
        id: string;
        chapter_order: number;
        name: string;
        body_simplified: string;
        body_traditional: string;
      }) => ({
        id: chapter.id,
        order: chapter.chapter_order,
        name: chapter.name,
        body: chineseMode === 'TRADITIONAL' ? chapter.body_traditional : chapter.body_simplified,
        bodySimplified: chapter.body_simplified,
        bodyTraditional: chapter.body_traditional,
      })),
      readingPreferences: {
        fontFamily: String(preferences?.fontFamily ?? 'Merriweather'),
        fontSize: Number(preferences?.fontSize ?? 18),
        lineSpacing: Number(preferences?.lineSpacing ?? 1.5),
        readerMode: String(preferences?.readerMode ?? 'PAGINATION'),
        theme: String(preferences?.theme ?? 'paper'),
        nightMode: Boolean(preferences?.nightMode ?? false),
        chineseMode,
        updatedAt: String(preferences?.updatedAt ?? new Date().toISOString()),
      },
      averageRating: Number(ratings.rows[0]?.average_rating ?? 0),
    };
  }

  async getCommunityThread(viewer: SessionUser, titleId: string): Promise<CommunityThreadModel> {
    const viewerState = await this.databaseService.query<{
      viewer_has_favorited: boolean;
      viewer_follows_author: boolean;
      viewer_follows_series: boolean;
    }>(
      `
      SELECT EXISTS (
               SELECT 1 FROM favorites
               WHERE favorites.user_id = $2 AND favorites.title_id = titles.id
             ) AS viewer_has_favorited,
             EXISTS (
               SELECT 1 FROM author_subscriptions
               WHERE author_subscriptions.user_id = $2 AND author_subscriptions.author_id = titles.author_id
             ) AS viewer_follows_author,
             CASE
               WHEN titles.series_id IS NULL THEN FALSE
               ELSE EXISTS (
                 SELECT 1 FROM series_subscriptions
                 WHERE series_subscriptions.user_id = $2 AND series_subscriptions.series_id = titles.series_id
               )
             END AS viewer_follows_series
      FROM titles
      WHERE titles.id = $1
      `,
      [titleId, viewer.id],
    );

    const commentsResult = await this.databaseService.query<{
      id: string;
      parent_comment_id: string | null;
      comment_type: string;
      body: string;
      is_hidden: boolean;
      created_at: string | number | Date;
      author_name: string;
      author_id: string;
      viewer_has_blocked: boolean;
      author_has_blocked_viewer: boolean;
      viewer_has_muted: boolean;
    }>(
      `
      SELECT comments.id,
             comments.parent_comment_id,
             comments.comment_type,
             comments.body,
             comments.is_hidden,
             comments.created_at,
             users.display_name AS author_name,
             users.id AS author_id,
             EXISTS (
               SELECT 1 FROM user_blocks
               WHERE blocker_user_id = $2 AND blocked_user_id = users.id
             ) AS viewer_has_blocked,
             EXISTS (
               SELECT 1 FROM user_blocks
               WHERE blocker_user_id = users.id AND blocked_user_id = $2
             ) AS author_has_blocked_viewer,
             EXISTS (
               SELECT 1 FROM user_mutes
               WHERE muter_user_id = $2 AND muted_user_id = users.id
             ) AS viewer_has_muted
      FROM comments
      JOIN users ON users.id = comments.user_id
      WHERE comments.title_id = $1
      ORDER BY comments.created_at ASC
      `,
      [titleId, viewer.id],
    );

    const commentMap = new Map<string, CommunityCommentModel>();
    const roots: CommunityCommentModel[] = [];

    for (const row of commentsResult.rows) {
      const masked = row.is_hidden || row.viewer_has_blocked || row.author_has_blocked_viewer || row.viewer_has_muted;
      const item: CommunityCommentModel = {
        id: row.id,
        authorId: row.author_id,
        authorName: row.author_name,
        commentType: row.comment_type,
        visibleBody: masked ? '[masked for viewer policy]' : row.body,
        createdAt: toIsoTimestamp(row.created_at),
        replies: [],
      };

      commentMap.set(row.id, item);
      if (row.parent_comment_id) {
        const parent = commentMap.get(row.parent_comment_id);
        if (parent) {
          parent.replies.push(item);
        }
      } else {
        roots.push(item);
      }
    }

    const ratings = await this.databaseService.query<{ average_rating: string | null; total_ratings: string }>(
      `
      SELECT ROUND(AVG(rating)::numeric, 2)::text AS average_rating,
             COUNT(*)::text AS total_ratings
      FROM ratings
      WHERE title_id = $1
      `,
      [titleId],
    );

    return {
      titleId,
      viewerHasFavorited: Boolean(viewerState.rows[0]?.viewer_has_favorited ?? false),
      viewerFollowsAuthor: Boolean(viewerState.rows[0]?.viewer_follows_author ?? false),
      viewerFollowsSeries: Boolean(viewerState.rows[0]?.viewer_follows_series ?? false),
      comments: roots,
      averageRating: Number(ratings.rows[0]?.average_rating ?? 0),
      totalRatings: Number(ratings.rows[0]?.total_ratings ?? 0),
    };
  }
}
