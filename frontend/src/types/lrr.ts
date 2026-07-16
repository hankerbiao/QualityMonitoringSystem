export interface LRRData {
  id: string;
  materialNo: string;
  materialDesc: string;
  totalCount: number | null;  // null = 无装配数据
  faultCount: number;
  lrrRate: number | null;     // null = 无分母
}

export interface PaginatedLRRResponse {
  items: LRRData[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}
