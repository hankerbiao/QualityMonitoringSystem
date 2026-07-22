// LRR (工厂阶段部件故障率) 前端类型，与 backend/app/schemas/lrr.py 对应

export type LRRFilterMode = 'all' | 'with_assembly' | 'without_assembly';
export type LRRTimeGranularity = 'none' | 'year' | 'month' | 'day';
export type LRRSortField = 'lrrRate' | 'faultCount' | 'totalCount' | 'materialNo';
export type LRRSortDir = 'asc' | 'desc';

export interface LRRFilters {
  filter?: LRRFilterMode;
  factory?: string | null;
  customer?: string | null;
  productFamily?: string | null;
  partType?: string | null;      // involved_component
  partPN?: string | null;        // reinsert_lot / product_no
  faultType?: string | null;     // fault_category
  dateFrom?: string | null;
  dateTo?: string | null;
  timeGranularity?: LRRTimeGranularity;
  sortBy?: LRRSortField;
  sortDir?: LRRSortDir;
}

export interface LRRData {
  id: string;
  materialNo: string;
  materialDesc: string;
  totalCount: number | null;  // null = 无装配数据
  faultCount: number;
  lrrRate: number | null;     // null = 无分母
}

export interface LRRTrendPoint {
  period: string;             // '2026' / '2026-07' / '2026-07-15'
  totalAssemblies: number;
  totalFaults: number;
  lrrRate: number | null;
}

export interface LRRDimensionStat {
  key: string;
  label: string;
  totalAssemblies: number;
  totalFaults: number;
  lrrRate: number | null;
}

export interface LRRSummary {
  materialKinds: number;
  withAssembly: number;
  withoutAssembly: number;
  totalAssemblies: number;
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
  trend: LRRTrendPoint[];
  byFactory: LRRDimensionStat[];
  byCustomer: LRRDimensionStat[];
  byProductFamily: LRRDimensionStat[];
  byFaultType: LRRDimensionStat[];
}

export interface LRROptions {
  factories: string[];
  customers: string[];
  productFamilies: string[];
  partTypes: string[];        // involved_component
  faultTypes: string[];       // fault_category
}

export interface LRRFaultDetail {
  sn: string;
  saleNo: string;
  mfgOrder: string;
  factory: string;
  customer: string;
  productFamily: string;
  productionTime: string;
  repairTime: string;
  partPN: string;
  partType: string;
  partDesc: string;
  faultType: string;
  faultDesc: string;
  fault2ndAppear: string;
  fault3rdAppear: string;
}
