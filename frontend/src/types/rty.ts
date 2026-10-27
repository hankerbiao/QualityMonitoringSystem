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
  faultSerialNumbers?: string[] | null;
  productLine: string;
  status: string;
}

export interface RTYTemplateExport {
  summary: Record<string, string | number | boolean | null>[];
  orders: Record<string, string | number | boolean | null>[];
  faults: Record<string, string | number | boolean | null>[];
  topProblems: Record<string, string | number | boolean | null>[];
  modelSheets?: RepairModelSheet[];
}

export interface RepairModelSheet {
  model: string;
  rows: Record<string, string | number | null>[];
}

export interface ExcludedOrder {
  id: string;
  time: string;
  salesOrder: string;
  productionOrder: string;
  productModel: string;
  customer: string;
  base: string;
  orderStatus: string;
  orderType: string;
  exclusionReasons: string[];
}

export interface StationPassExport {
  orders: Record<string, unknown>[];
  faults: Record<string, unknown>[];
  modelSheets?: RepairModelSheet[];
}

export interface RTYCycleDetailQuery {
  dateFrom: string;
  dateTo: string;
  orderScope: 'normal' | 'l6';
  productModels?: string[];
  customers?: string[];
  bases?: string[];
}

export interface RTYCycleDetails {
  orders: Record<string, unknown>[];
  faults: Record<string, unknown>[];
}

export interface StationPassRate {
  dimensionValue: string;
  stationCode: string;
  stationName: string;
  inputCount: number;
  defectCount: number;
  passRate: number;
  totalInputCount: number;
  totalDefectCount: number;
}

export type StationGroupBy = 'salesOrder' | 'productionOrder' | 'productModel';

export interface StationPassQuery {
  dateFrom?: string;
  dateTo?: string;
  serialNumber?: string;
  productModels?: string[];
  customers?: string[];
  bases?: string[];
  productModel?: string;
  customer?: string;
  base?: string;
  groupBy: StationGroupBy;
  orderScope?: 'normal' | 'l6';
  overseas?: boolean;
  dimensionValue?: string;
}

export interface StationPassDetail {
  id: string;
  sn: string;
  stationCode: string;
  stationName: string;
  passDate: string;
  status: 'passed' | 'defect';
  repairTime: string;
  defectCode: string;
  description: string;
  repairPerson: string;
  matchedModel?: string;
  raw?: Record<string, unknown>;
}

export interface RepairQualityDistribution {
  repairCount: string;
  snCount: number;
  percentage: number;
}

export interface RepairQualityGroup {
  customer: string;
  base: string;
  snCount: number;
  firstPassCount: number;
  repeatCount: number;
  firstPassRate: number;
  distribution: RepairQualityDistribution[];
}

export interface RepairQualitySummary extends Omit<RepairQualityGroup, 'customer' | 'base'> {
  groups: RepairQualityGroup[];
}

export interface RepairQualityOptions {
  productModels: string[];
  customers: string[];
  bases: string[];
}

export interface RepairQualityQuery {
  dateFrom: string;
  dateTo: string;
  productModels?: string[];
  customers?: string[];
  bases?: string[];
}

export type RepairQualityBucket = 'all' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9+';

export interface RepairQualityDetailQuery extends RepairQualityQuery {
  customer: string;
  base: string;
  bucket: RepairQualityBucket;
}

export interface RepairQualityDetail {
  sn: string;
  productionOrders: string[];
  models: string[];
  repairCount: number;
  repairs: {
    productionOrder: string;
    salesOrder: string;
    station: string;
    faultCode: string;
    description: string;
    foundDate: string;
    repairDate: string;
    repairPerson: string;
  }[];
}

export interface RepairQualityDetails {
  items: RepairQualityDetail[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RepairQualityExport extends StationPassExport {
  summary: RepairQualitySummary;
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
  orderScope: 'normal' | 'l6';
  calculationMethod?: 'normal' | 'composite';
  productModels?: string[];
  bases?: string[];
  customers?: string[];
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

export interface PaginatedExcludedOrdersResponse {
  items: ExcludedOrder[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}
