export interface MetadataColumn {
  key: string;
  label: string;
}

export interface MetadataTableResponse {
  key: string;
  title: string;
  description: string;
  columns: MetadataColumn[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
  search: string;
  rows: Record<string, unknown>[];
}
