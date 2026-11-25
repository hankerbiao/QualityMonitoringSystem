export interface MFRFilters {
  dateFrom: string;
  dateTo: string;
  model?: string;
  customerId?: string;
  customerIds?: string[];
}

export interface MFRDimensionItem {
  key: string;
  faultCount: number;
  fleetCount: number | null;
  mfrRate: number | null;
}

export interface MFRTrendItem extends MFRDimensionItem {
  period: string;
}

export interface MFRDailyTrendItem {
  period: string;
  faultCount: number;
}

export interface MFRDashboard {
  filters: MFRFilters;
  summary: {
    faultCount: number;
    fleetCount: number | null;
    mfrRate: number | null;
    denominatorSource?: string;
    shipmentDeviceCount?: number;
    shipmentRecordCount?: number;
    shipmentBatchCount?: number;
    shipmentMissingSerialCount?: number;
    shipmentUnknownModelCount?: number;
    shipmentFallbackModelCount?: number;
    sourceDeviceCount: number;
    selectedDeviceCount: number;
    deviceIssues: Record<string, number>;
    unmatchedChangeCount: number;
  };
  trend: MFRTrendItem[];
  dailyTrend: MFRDailyTrendItem[];
  byModel: MFRDimensionItem[];
  modelOptions?: string[];
  customerIds?: string[];
}

export interface MFRFaultDetail {
  model: string;
  plannedDate: string;
  shipmentDate: string;
  productionOrder: string;
  deviceSn: string;
  deviceKey?: string;
  doaCode: string;
  faultDate: string;
  serviceOrder: string;
  changeId: string;
  changeType: string;
  occurredAt: string;
  partNumber: string;
  partSn: string;
  partName: string;
  customer: string;
}

export interface MFRExport extends MFRDashboard {
  faultDetails: MFRFaultDetail[];
  deviceIssueDetails: {
    reason: string;
    deviceKey: string;
    deviceSn: string;
    identityBasis: string;
    doaCodes: string[];
    salesOrders: string[];
    serviceOrders: string[];
    declarationStates: string[];
  }[];
  changeIssueDetails: {
    reason: string;
    deviceKey: string;
    deviceSn: string;
    changeDeviceSn: string;
    serviceOrder: string;
    doaCodes: string[];
    changeId: string;
    changeType: string;
    occurredAt: string;
    partNumber: string;
    partSn: string;
  }[];
}
