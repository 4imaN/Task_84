export type Role =
  | 'CUSTOMER'
  | 'CLERK'
  | 'MODERATOR'
  | 'MANAGER'
  | 'FINANCE'
  | 'INVENTORY_MANAGER';

export type Workspace = 'app' | 'pos' | 'mod' | 'admin' | 'finance';

export type ReaderMode = 'PAGINATION' | 'SCROLL';
export type ReaderTheme = 'linen' | 'mist' | 'sepia' | 'paper';
export type ChineseMode = 'SIMPLIFIED' | 'TRADITIONAL';

export interface ReadingPreferences {
  fontFamily: 'Merriweather' | 'Noto Sans' | 'Source Serif';
  fontSize: number;
  lineSpacing: number;
  readerMode: ReaderMode;
  theme: ReaderTheme;
  nightMode: boolean;
  chineseMode: ChineseMode;
  updatedAt: string;
}

export interface ReadingProfileRecord {
  username: string;
  preferences: ReadingPreferences;
  deviceLabel: string;
  updatedAt: string;
}

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
  workspace: Workspace;
}

export interface CatalogTitleSummary {
  id: string;
  slug: string;
  name: string;
  format: 'DIGITAL' | 'PHYSICAL' | 'BUNDLE';
  price: number;
  inventoryOnHand: number;
  authorName: string;
  seriesName?: string;
}

export interface RecommendationResult {
  titleId: string;
  reason: 'SIMILAR' | 'TOP_N' | 'BESTSELLER_FALLBACK';
  recommendedTitleIds: string[];
  traceId: string;
}

export interface AuditEnvelope {
  traceId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export const workspaceRoleMap: Record<Workspace, Role[]> = {
  app: ['CUSTOMER'],
  pos: ['CLERK'],
  mod: ['MODERATOR'],
  admin: ['MANAGER', 'INVENTORY_MANAGER'],
  finance: ['FINANCE'],
};
