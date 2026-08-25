export interface RTYData {
  id: string;
  time: string;
  model: string;
  productModel: string;
  customer: string;
  base: string;
  defectCount: number;
  inputCount: number;
  rtyRate: number;
  targetRate: number;
  salesOrder: string;
  productionOrder: string;
  salesOrders: string[];
  productionOrders: string[];
  serialNumbers: string[];
  productLine: string;
  status: string;
}

export interface DefectDetail {
  id: string;
  defectCode: string;
  description: string;
  count: number;
  sn: string;
  sale_no: string;
  mfg_order: string;
  product_family: string;
  fault_2nd_appear: string;
  fault_3rd_appear: string;
  repairTime: string;
  repairPerson: string;
  repair_effectiveness: string;
  customer: string;
}

export interface RTYFilterParams {
  dateRange: { from: Date | undefined; to: Date | undefined };
  productModel: string;
  customer: string;
  base: string;
  salesOrder: string;
  productionOrder: string;
  serialNumber: string;
}

export type SortField = 'time' | 'defectCount' | 'inputCount' | 'rtyRate';

export interface SalesOrderSummary {
  salesOrder: string;
  inputCount: number;
  defectCount: number;
  rtyRate: number;
}

export interface PaginatedRTYResponse {
  items: RTYData[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}
