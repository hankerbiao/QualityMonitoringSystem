import type { DefectDetail } from './rty';

export interface AlertContext {
  productModel?: string;
  base?: string;
  customer?: string;
  salesOrder?: string;
  productionOrder?: string;
  serialNumber?: string;
  dateFrom?: string;
  dateTo?: string;
  alertType?: string;
  severity?: string;
  title?: string;
}

export interface AlertReportSummary {
  rtyRate: number;
  targetRate: number;
  defectCount: number;
  inputCount: number;
  productModel: string;
  base: string;
  customer: string;
  periodFrom?: string;
  periodTo?: string;
  reached: boolean;
}

export interface AlertReportData {
  context: AlertContext;
  summary: AlertReportSummary;
  defects: DefectDetail[];
  generatedAt: string;
  expiresAt: string;
}
