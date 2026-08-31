export type LRROrderDimension = 'productionOrder' | 'salesOrder';
export type LRRSortField = 'lrrRate' | 'faultCount' | 'issuedQuantity' | 'orderNo';
export type LRRSortDir = 'asc' | 'desc';

export interface LRRFilters {
  groupBy?: LRROrderDimension;
  productionOrder?: string | null;
  salesOrder?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  orderKeyword?: string | null;
  sortBy?: LRRSortField;
  sortDir?: LRRSortDir;
}

export interface LRRData {
  id: string;
  orderDimension: LRROrderDimension;
  orderNo: string;
  productionOrder: string;
  salesOrder: string;
  issuedQuantity: number;
  faultCount: number;
  lrrRate: number | null;
}

export interface LRRSummary {
  orderCount: number;
  issuedQuantity: number;
  totalFaults: number;
  overallLrr: number | null;
}

export interface LRRListResponse {
  items: LRRData[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
  summary: LRRSummary;
}

export interface LRROptions {
  productionOrders: string[];
  salesOrders: string[];
  storageLocations: string[];
}

export interface LRRFaultDetail {
  orderDimension: LRROrderDimension;
  orderNo: string;
  productionOrder: string;
  salesOrder: string;
  storageLocation: string;
  sn: string;
  faultType: string;
  faultDesc: string;
  repairTime: string;
}

export interface LRRFaultDetailsResponse {
  items: LRRFaultDetail[];
  total: number;
  truncated: boolean;
}
