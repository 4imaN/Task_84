import type { ReadingProfileRecord, SessionUser } from '@ledgerread/contracts';

export type AppSession = {
  user: SessionUser;
  homePath: string;
};

export type Toast = {
  id: string;
  message: string;
};

export type TitleCard = {
  id: string;
  slug: string;
  name: string;
  format: string;
  price: number;
  inventoryOnHand: number;
  authorName: string;
  authorId: string;
  seriesName?: string;
  seriesId?: string;
};

export type CatalogResponse = {
  catalog: {
    featured: TitleCard[];
    bestSellers: TitleCard[];
  };
};

export type TitleChapter = {
  id: string;
  order: number;
  name: string;
  body: string;
  bodySimplified?: string;
  bodyTraditional?: string;
};

export type TitleDetail = {
  id: string;
  slug: string;
  name: string;
  format: string;
  price: number;
  inventoryOnHand: number;
  authorName: string;
  authorId: string;
  seriesName?: string;
  seriesId?: string;
  averageRating: number;
  readingPreferences: ReadingProfileRecord['preferences'];
  chapters: TitleChapter[];
};

export type TitleDetailResponse = {
  title: TitleDetail;
};

export type CommunityComment = {
  id: string;
  authorId: string;
  authorName: string;
  commentType: 'COMMENT' | 'QUESTION';
  visibleBody: string;
  createdAt: string;
  replies: CommunityComment[];
};

export type CommunityThreadResponse = {
  communityThread: {
    titleId: string;
    viewerHasFavorited: boolean;
    viewerFollowsAuthor: boolean;
    viewerFollowsSeries: boolean;
    averageRating: number;
    totalRatings: number;
    comments: CommunityComment[];
  };
};

export type RecommendationResponse = {
  recommendations: {
    titleId: string;
    reason: string;
    recommendedTitleIds: string[];
    traceId: string;
  };
};

export type QueueItem = {
  id: string;
  category: string;
  notes: string;
  status: string;
  created_at: string;
  comment_id: string | null;
  comment_body: string | null;
  comment_hidden: boolean | null;
  comment_author_id: string | null;
  comment_author_name: string | null;
  title_name: string | null;
  reporter_name: string;
};

export type SettlementResponse = {
  paymentPlans: Array<{
    id: string;
    supplier_name: string;
    status: string;
    created_at: string;
    statement_reference?: string | null;
    invoice_reference?: string | null;
    freight_cents?: number | null;
    surcharge_cents?: number | null;
    invoiceAmount?: number;
    landedCost?: number;
  }>;
  discrepancies: Array<{
    id: string;
    sku: string;
    quantity_difference: number;
    amount_difference_cents: number;
    amountDifference: number;
    status: string;
    created_at: string;
    statement_reference?: string | null;
    invoice_reference?: string | null;
  }>;
};

export type AuditLog = {
  id: string;
  trace_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  previous_hash: string | null;
  current_hash: string;
  created_at: string;
};

export type AuditPayloadValue = {
  key: string;
  label: string;
  value: string;
};

export type InventorySuggestion = {
  sku: string;
  name: string;
  titleName?: string | null;
  format?: string | null;
  onHand: number;
  price: number;
};

export type ManifestLineItem = {
  sku: string;
  statementQuantity: number;
  invoiceQuantity: number;
  statementExtendedAmount: number;
  invoiceExtendedAmount: number;
};

export type CartSummary = {
  cartId: string;
  items: Array<{
    cartItemId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
    onHand: number;
  }>;
  suggestions: Array<{ sku: string; name: string }>;
  stockIssues: Array<{
    sku: string;
    requestedQuantity: number;
    availableQuantity: number;
  }>;
  subtotal: number;
  discount: number;
  fees: number;
  total: number;
  reviewReady: boolean;
  reviewedAt?: string | null;
};

export type RiskAlert = {
  id: string;
  description: string;
  username: string;
  created_at: string;
};

export type PaymentMethod = 'CASH' | 'EXTERNAL_TERMINAL';
export type PaymentPlanStatus = 'PENDING' | 'MATCHED' | 'PARTIAL' | 'PAID' | 'DISPUTED';
