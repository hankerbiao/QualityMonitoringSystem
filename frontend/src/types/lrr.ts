export type LRRSortField = 'lrrRate' | 'faultCount' | 'issuedQuantity' | 'materialNo';
export type LRRSortDir = 'asc' | 'desc';

export interface LRRFilters {
  productionOrder?: string | null;
  salesOrder?: string | null;
  storageLocation?: string | null;
  sortBy?: LRRSortField;
  sortDir?: LRRSortDir;
}

export interface LRRData {
  id: string;
  materialNo: string;
  materialDesc: string;
  issuedQuantity: number;
  faultCount: number;
  lrrRate: number | null;
}

export interface LRRSummary {
  materialKinds: number;
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
  materialNo: string;
  materialDesc: string;
  productionOrder: string;
  salesOrder: string;
  storageLocation: string;
  sn: string;
  faultType: string;
  faultDesc: string;
  repairTime: string;
}
