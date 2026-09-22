export type LRRSortField = 'month' | 'lrrRate' | 'faultCount' | 'issuedQuantity' | 'materialNumber';
export type LRRSortDir = 'asc' | 'desc';

export interface LRRFilters {
  plannedDateFrom?: string | null;
  plannedDateTo?: string | null;
  ngDateFrom?: string | null;
  ngDateTo?: string | null;
  materialNumber?: string | null;
  productModel?: string | null;
  base?: string | null;
  customerId?: string | null;
  month?: string | null;
  sortBy?: LRRSortField;
  sortDir?: LRRSortDir;
}

export interface LRRData {
  id: string;
  month: string;
  materialDescription: string;
  issuedQuantity: number;
  faultCount: number;
  lrrRate: number | null;
  materialNumber: string;
}

export interface LRRSummary {
  materialCount: number;
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
  productModels: string[];
  bases: string[];
  customerIds: string[];
}

export interface LRRFaultDetail {
  month: string;
  materialNumber: string;
  materialDescription: string;
  sn: string;
  faultType: string;
  faultDesc: string;
  ngTime: string;
}

export interface LRRFaultDetailsResponse {
  items: LRRFaultDetail[];
  total: number;
  truncated: boolean;
}
