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
  serialNumbers: string[];
  productLine: string;
  orderType: string;
  planStartDate: string;
  planEndDate: string;
  status: string;
}

export interface DefectDetail {
  id: string;
  defectCode: string;
  description: string;
  count: number;
  sn: string;
  repairTime: string;
  repairPerson: string;
}

export interface InputDetail {
  id: string;
  workOrder: string;
  productLine: string;
  count: number;
}

export interface RTYFilterParams {
  statMethod: string;
  dateRange: { from: Date | undefined; to: Date | undefined };
  model: string;
  productModel: string;
  customer: string;
  base: string;
  salesOrder: string;
  productionOrder: string;
  serialNumber: string;
  aggregateBy?: 'mfg_order' | 'product_model' | 'base';
}

export type SortField = 'time' | 'defectCount' | 'inputCount' | 'rtyRate';

export interface SalesOrderSummary {
  salesOrder: string;
  inputCount: number;
  defectCount: number;
  rtyRate: number;
}