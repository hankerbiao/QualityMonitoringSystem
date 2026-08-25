/** 销售订单文档（按 AUFNR 去重，来自 sales_orders_sap 集合） */
export interface SalesOrderDocument {
  id: string;
  aufnr: string;
  /** SAP 原始记录（AUFNR/MAKTX_TH/LGORT/GSTRS 等，优先取 KK 来源） */
  data: Record<string, unknown>;
  /** 各来源原始记录 { SG: {...}, KK: {...} } */
  source_records: Record<string, unknown>;
  /** 本次同步命中该订单的来源列表（SG/KK） */
  sources: string[];
  /** 归一化订单数量，源自 data.GAMNG */
  quantity: number;
  /** 归一化计划开始日期 YYYY-MM-DD，源自 data.GSTRS，可为 null */
  gstrs_date: string | null;
  first_seen_at: string | null;
  last_synced_at: string | null;
  sync_count: number;
}

export interface PaginatedSalesOrders {
  items: SalesOrderDocument[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface SalesOrderFilterOptions {
  models: string[];
  bases: string[];
  customers: string[];
}

export interface SalesOrderStatsItem {
  key: string;
  count: number;
}

export interface SalesOrderStats {
  total: number;
  /** 机器总数量（quantity 求和，随筛选条件联动） */
  total_quantity: number;
  by_model: SalesOrderStatsItem[];
  by_base: SalesOrderStatsItem[];
  by_month: SalesOrderStatsItem[];
}

export interface SalesOrdersQueryResponse extends PaginatedSalesOrders {
  stats: SalesOrderStats;
  filterOptions: SalesOrderFilterOptions;
}

export interface SalesOrderFilterParams {
  /** 机型 (MAKTX_TH) 多选 */
  cpXh: string[];
  /** 基地 (LGORT) 多选 */
  lgort: string[];
  /** 开始日期 YYYY-MM-DD（data.GSTRS） */
  dateFrom: string;
  /** 结束日期 YYYY-MM-DD（data.GSTRS） */
  dateTo: string;
  /** 订单号 (AUFNR) 模糊搜索 */
  keyword: string;
}

/** 单个 SAP 来源的同步结果 */
export interface SalesOrderSourceSyncResult {
  success: boolean;
  fetched_count: number;
  unique_count: number;
  skipped_count: number;
  error: string | null;
}

/** 同步接口响应（POST /api/sales-orders/sync） */
export interface SalesOrderSyncResult {
  success: boolean;
  partial_success: boolean;
  date_range: { start_date: string; end_date: string };
  sources: Record<string, SalesOrderSourceSyncResult>;
  total_fetched: number;
  total_unique: number;
  total_skipped: number;
  inserted: number;
  updated: number;
  orders: SalesOrderDocument[];
}
