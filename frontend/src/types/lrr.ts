export type LRRSortField = 'month' | 'lrrRate' | 'faultCount' | 'issuedQuantity' | 'materialNumber';
export type LRRSortDir = 'asc' | 'desc';

export interface LRRFilters {
  serialNumbers?: string[];
  productionOrders?: string[];
  salesOrders?: string[];
  plannedDateFrom?: string | null;
  plannedDateTo?: string | null;
  ngDateFrom?: string | null;
  ngDateTo?: string | null;
  materialNumber?: string | null;
  productModels?: string[] | null;
  bases?: string[] | null;
  customerIds?: string[] | null;
  orderTypes?: string[] | null;
  month?: string | null;
  sortBy?: LRRSortField;
  sortDir?: LRRSortDir;
}

export interface LRRData {
  id: string;
  month: string;
  materialDescription: string;
  issuedQuantity: number;
  faultCount: number | null;
  lrrRate: number | null;
  materialNumber: string;
}

export interface LRRSummary {
  materialCount: number;
  issuedQuantity: number;
  totalFaults: number | null;
  overallLrr: number | null;
  scope?: 'usage' | 'page' | 'full';
}

export interface LRRTrendPoint {
  month: string;
  issuedQuantity: number;
  faultCount: number | null;
  lrrRate: number | null;
}

export interface LRRMaterialRank {
  materialNumber: string;
  materialDescription: string;
  issuedQuantity: number;
  faultCount: number;
  lrrRate: number | null;
}

export interface LRRListResponse {
  items: LRRData[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
  summary: LRRSummary;
  trend?: LRRTrendPoint[];
  hotspots?: LRRMaterialRank[];
}

export interface LRROptions {
  materialNumbers: string[];
  productModels: string[];
  bases: string[];
  customerIds: string[];
  orderTypes?: string[];
}

export interface LRRFaultDetail {
  month: string;
  materialNumber: string;
  materialDescription: string;
  sn: string;
  faultType: string;
  faultDesc: string;
  matchedModel: string;
  salesOrder: string;
  productionOrder: string;
  faultPhenomenon: string;
  repairAction: string;
  station: string;
  repairPerson: string;
  repairTime: string;
  ngTime: string;
  raw?: Record<string, unknown>;
}

export interface LRRFaultDetailsResponse {
  items: LRRFaultDetail[];
  total: number;
  truncated: boolean;
}

export interface LRRUsageByOrder {
  productionOrder: string;
  salesOrder: string;
  materialNumber: string;
  materialDescription: string;
  productModel: string;
  base: string;
  plannedQuantity: number | null;
  issuedQuantity: number;
  returnedQuantity: number;
  usageQuantity: number;
}

export interface LRRUsageDetailsResponse {
  items: LRRUsageByOrder[];
  total: number;
  issuedQuantity: number;
  returnedQuantity: number;
  usageQuantity: number;
  quantityMode: 'movement' | 'legacy';
}

export interface LRRFilteredOrder {
  id: string;
  productionOrder: string;
  salesOrder: string;
  materialNumber: string;
  materialDescription: string;
  productModel: string;
  base: string;
  customerId: string;
  plannedDate: string;
  movementType: string;
  quantity: number | null;
  orderStatus: string;
  orderType: string;
  reversalFlag: string;
  exclusionReasons: string[];
}

export interface LRRFilteredOrdersResponse {
  items: LRRFilteredOrder[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}
