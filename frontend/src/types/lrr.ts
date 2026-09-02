export type LRRSortField = 'lrrRate' | 'faultCount' | 'issuedQuantity' | 'orderNo';
export type LRRSortDir = 'asc' | 'desc';

export interface LRRFilters {
  dateFrom?: string | null;
  dateTo?: string | null;
  materialNumber?: string | null;
  base?: string | null;
  customerId?: string | null;
  month?: string | null;
  orderKeyword?: string | null;
  sortBy?: LRRSortField;
  sortDir?: LRRSortDir;
}

export interface LRRData {
  id: string;
  orderNo: string;
  productionOrder: string;
  salesOrder: string;
  issuedQuantity: number;
  faultCount: number;
  lrrRate: number | null;
  materialNumber: string;
  base: string;
  customerId: string;
  month: string;
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
  materialNumbers: string[];
  bases: string[];
  customerIds: string[];
}

export interface LRRFaultDetail {
  orderNo: string;
  productionOrder: string;
  salesOrder: string;
  materialNumber?: string;
  base?: string;
  customerId?: string;
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
