export type FAStage = '产测' | 'DOA';

export interface FAPreviewRequest {
  pn: string;
  vendor: string;
  faultDescription: string;
  stages: FAStage[];
  repairDateFrom?: string;
  repairDateTo?: string;
  doaDateFrom?: string;
  doaDateTo?: string;
}

export interface FARepairFault {
  sourceId: string;
  base: string;
  productionOrder: string;
  model: string;
  sn: string;
  station: string;
  ngTime: string;
  faultDimension3: string;
  faultDimension2: string;
  repairDimension3: string;
  materialNumber: string;
  nonCriticalMaterialNumber: string;
  materialDescription: string;
  serialNumber: string;
  originalFactoryCode: string;
}

export interface FADOAChange {
  sourceId: string;
  pn: string;
  sn: string;
  spareName: string;
  originalCode: string;
  reportedDevice: string;
  operationTime: string;
}

export interface FAStageSummary {
  issuedQuantity: number;
  faultCount: number;
  faultRate: number | null;
  materialDescription?: string;
}

export interface FAPreview {
  pn: string;
  materialDescription: string;
  repair: FAStageSummary;
  doa: FAStageSummary;
  repairFaults: FARepairFault[];
  doaChanges: FADOAChange[];
}

export interface FAApplication extends FAPreviewRequest {
  applicationId: string;
  materialDescription: string;
  repairSummary: FAStageSummary;
  doaSummary: FAStageSummary;
  repairFaults: FARepairFault[];
  doaChanges: FADOAChange[];
  createdBy: string;
  createdByName: string;
  createdAt: string;
  email: {
    status: 'pending' | 'failed' | 'sent';
    to: string[];
    cc: string[];
    subject?: string;
    content?: string;
    sentAt: string | null;
    error: string | null;
  };
}

