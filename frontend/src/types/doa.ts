export type DoaTimeGranularity = 'year' | 'month' | 'day';

export interface DoaFilters {
  dateFrom: string;
  dateTo: string;
  acceptedDateFrom?: string;
  acceptedDateTo?: string;
  customer: string;
  customerId?: string;
  model: string;
  customers?: string[];
  customerIds?: string[];
  models?: string[];
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
  cacheExpiresAt?: string | null;
  summary: {
    shippedCount: number;
    repairCount: number;
    repairRate: number | null;
    replacementCount: number;
    replacementRate: number | null;
    replacementRecordCount: number;
    matchedRepairRecords: number;
    excludedRepairRecords: number;
    unmatchedRepairRecords: number;
    missingQuantityRecords: number;
    invalidDeclarationDateRecords: number;
    invalidDeclarationDateQuantity: number;
    latestDataAt: string | null;
  };
  trend: DoaTrendItem[];
  byCustomer: DoaDimensionItem[];
  byModel: DoaDimensionItem[];
  unmatchedOrders: { salesOrder: string; recordCount: number }[];
}

export interface DoaOrderItem {
  salesOrder: string;
  deliveryNumber: string;
  deliveryItem?: string;
  materialNumber?: string;
  customer: string;
  customerId?: string;
  model: string;
  shipmentDate: string;
  quantity: number;
}
export interface DoaOrdersResponse {
  items: DoaOrderItem[];
  total: number;
  totalQuantity: number;
  page: number;
  limit: number;
}

export interface DoaAudit {
  repairs: { matchStatus: string; salesOrder: string; id: string; doaCode?: string; acceptedAt: string; declarationDate?: string; repairCount: number | string; raw: Record<string, unknown> }[];
  orders: Record<string, unknown>[];
  changes: Record<string, unknown>[];
}

export interface DoaRepairItem {
  id: string;
  doaCode?: string;
  salesOrder: string;
  materialSerial: string;
  acceptedAt: string;
  declarationDate: string;
  customer: string;
  customerId?: string;
  model: string;
  repairCount: number;
  missingQuantity: boolean;
  data: Record<string, unknown>;
}

export interface DoaRepairsResponse {
  items: DoaRepairItem[];
  total: number;
  totalRepairCount: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface DoaOptions {
  customers: string[];
  models: string[];
  customerIds?: string[];
}

export interface DoaRawItem {
  id: string;
  data: Record<string, string | number | null | undefined>;
}

export interface DoaRawFilters {
  acceptedDateFrom?: string;
  acceptedDateTo?: string;
  keyword?: string;
  serviceNumber?: string;
  salesOrder?: string;
  serialNumber?: string;
  customer?: string;
  product?: string;
  doaType?: string;
  judgment?: string;
  processingStatus?: string;
}

export interface DoaRawDashboard {
  summary: {
    total: number;
    judgmentYes: number;
    judgmentNo: number;
    latestAcceptedAt: string | null;
  };
  trend: { date: string; label: string; count: number }[];
  byType: { key: string; count: number }[];
  byProcessingStatus: { key: string; count: number }[];
  items: DoaRawItem[];
  pagination: { page: number; limit: number; total: number; hasMore: boolean };
}
