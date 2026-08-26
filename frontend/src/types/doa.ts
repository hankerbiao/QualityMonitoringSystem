export type DoaTimeGranularity = 'year' | 'month' | 'day';

export interface DoaFilters {
  dateFrom: string;
  dateTo: string;
  acceptedDateFrom?: string;
  acceptedDateTo?: string;
  customer: string;
  model: string;
  timeGranularity: DoaTimeGranularity;
}

export interface DoaDimensionItem {
  key: string;
  shippedCount: number;
  repairCount: number;
  repairRate: number | null;
  replacementCount: number;
  replacementRate: number | null;
}

export interface DoaTrendItem extends DoaDimensionItem {
  period: string;
  repairServerCount: number;
}

export interface DoaDashboard {
  filters: DoaFilters;
  summary: {
    shippedCount: number;
    repairCount: number;
    repairRate: number | null;
    replacementCount: number;
    replacementRate: number | null;
    matchedRepairRecords: number;
    excludedRepairRecords: number;
    latestDataAt: string | null;
  };
  trend: DoaTrendItem[];
  byCustomer: DoaDimensionItem[];
  byModel: DoaDimensionItem[];
}

export interface DoaRepairItem {
  id: string;
  salesOrder: string;
  materialSerial: string;
  acceptedAt: string;
  customer: string;
  model: string;
  shippedDate: string;
  shippedCount: number;
  repairCount: number;
  data: Record<string, unknown>;
}

export interface DoaRepairsResponse {
  items: DoaRepairItem[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface DoaOptions {
  customers: string[];
  models: string[];
}

export interface DoaRawEnrichment {
  status: 'success' | 'failed' | 'pending' | 'skipped';
  sales_order?: string | null;
  [key: string]: unknown;
}

export interface DoaRawItem {
  id: string;
  data: Record<string, string | number | null | undefined>;
  enrichment: DoaRawEnrichment;
}

export interface DoaRawDashboard {
  summary: {
    total: number;
    judgmentYes: number;
    judgmentNo: number;
    enrichedSuccess: number;
    enrichmentFailed: number;
    enrichmentPending: number;
    enrichmentSkipped: number;
    latestAcceptedAt: string | null;
  };
  trend: { date: string; label: string; count: number }[];
  byType: { key: string; count: number }[];
  byProcessingStatus: { key: string; count: number }[];
  byEnrichmentStatus: { key: string; count: number }[];
  items: DoaRawItem[];
  pagination: { page: number; limit: number; total: number; hasMore: boolean };
}
