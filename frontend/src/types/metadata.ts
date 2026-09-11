export interface MetadataColumn {
  key: string;
  label: string;
}

export interface MetadataFilter {
  key: string;
  label: string;
  match?: 'contains' | 'exact' | 'dateFrom' | 'dateTo';
  inputType?: 'text' | 'date';
}

export interface MetadataTableResponse {
  key: string;
  title: string;
  description: string;
  columns: MetadataColumn[];
  filters: MetadataFilter[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
  search: string;
  rows: Record<string, unknown>[];
}
