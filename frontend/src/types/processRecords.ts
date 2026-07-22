export type ProcessRecordSource = 'all' | 'system1' | 'system2';

export interface ProcessRecordPhoto {
  path: string;
}

export interface ProcessRecordItem {
  key: string;
  source: 'system1' | 'system2';
  sourceName: string;
  recordId: string;
  sn: string;
  base: string;
  station: string;
  submittedAt: string;
  order: string;
  remarks: string;
  files: string;
  photos: ProcessRecordPhoto[];
  raw: Record<string, unknown>;
}

export interface ProcessRecordSourceResult {
  online: boolean;
  total: number;
  rows: ProcessRecordItem[];
  error?: string | null;
}

export interface ProcessRecordRealtimeData {
  queriedAt: string;
  source: ProcessRecordSource;
  page: number;
  pageSize: number;
  total: number;
  rows: ProcessRecordItem[];
  sources: Partial<Record<'system1' | 'system2', ProcessRecordSourceResult>>;
}

export interface ProcessRecordBaseOption {
  name: string;
  sources: ('system1' | 'system2')[];
}

export interface ProcessRecordFilterOptions {
  bases: ProcessRecordBaseOption[];
  system1Processes: string[];
}
