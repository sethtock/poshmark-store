// Shared types for the Poshmark store pipeline

export type ItemStatus =
  | 'pending_review'
  | 'ready_to_post'
  | 'posted'
  | 'needs_shipped'
  | 'shipped'
  | 'sold'
  | 'error';

export interface Item {
  id: string;            // item-001, item-002, etc.
  folderName: string;    // original Drive folder name
  folderId: string;      // Google Drive folder ID
  photoUrls: string[];   // Drive photo URLs
  description: string;   // AI-generated Poshmark listing description
  brand: string | null;
  size: string | null;
  color: string | null;
  condition: 'nwt' | 'nwot' | 'like_new' | 'good' | 'fair';
  category: string | null;
  initialPrice: number | null;
  currentPrice: number | null;
  poshmarkUrl: string | null;
  status: ItemStatus;
  notes: string;
  pricingReasoning: string;  // how the price was determined
  pricingConfidence: 'high' | 'medium' | 'low';
  dateAdded: string;     // ISO date string
  lastUpdated: string;   // ISO date string
}

export interface PricingResult {
  price: number;
  confidence: 'high' | 'medium' | 'low';
  comparables: ComparableItem[];
  reasoning: string;
}

export interface ComparableItem {
  title: string;
  price: number;
  soldDate: string;
  url: string;
  condition: string;
}

export interface AgentRunResult {
  itemsProcessed: number;
  itemsPosted: number;
  itemsPendingReview: number;
  errors: string[];
  summary: string;
}
