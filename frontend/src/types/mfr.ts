export interface MFRFilters {
  dateFrom: string;
  dateTo: string;
  model?: string;
}

export interface MFRDimensionItem {
  key: string;
  faultCount: number;
  fleetCount: number;
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
    fleetCount: number;
    mfrRate: number | null;
    sourceDeviceCount: number;
    selectedDeviceCount: number;
    deviceIssues: Record<string, number>;
    unmatchedChangeCount: number;
  };
  trend: MFRTrendItem[];
  dailyTrend: MFRDailyTrendItem[];
  byModel: MFRDimensionItem[];
}
