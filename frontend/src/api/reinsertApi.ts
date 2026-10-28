import { requestData } from './authApi';
import { API_BASE_URL } from '../constants';

export interface ReinsertQuery {
  dateFrom: string;
  dateTo: string;
  productModels?: string[];
  customers?: string[];
  bases?: string[];
}

export interface ReinsertCell {
  reinsertCount: number;
  repairCount: number;
  plannedQuantity: number | null;
  plannedRate: number | null;
  usageQuantity: number | null;
  usageRate: number | null;
  usageReason: string;
}
export interface ReinsertPN { pn: string; months: Record<string, ReinsertCell> }
export interface ReinsertComponent { component: string; months: Record<string, ReinsertCell>; pns: ReinsertPN[] }
export interface ReinsertBase {
  base: string;
  months: Record<string, ReinsertCell>;
  components: ReinsertComponent[];
  topPns: ReinsertPN[];
}
export interface ReinsertDashboard {
  months: string[];
  bases: ReinsertBase[];
  invalidCount: number;
  invalidReinsertCount: number;
}
export type DetailKind = 'reinsert' | 'repairs' | 'orders' | 'postings' | 'invalid';
export interface DetailQuery extends ReinsertQuery {
  kind: DetailKind;
  base?: string;
  month?: string;
  component?: string;
  pn?: string;
}
export interface DetailResult {
  items: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

function params(query: ReinsertQuery | DetailQuery) {
  const qs = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach(item => qs.append(key, item));
    else if (value) qs.set(key, value);
  });
  return qs;
}

export const reinsertApi = {
  options: () => requestData<{ productModels: string[]; customers: string[]; bases: string[] }>(
    `${API_BASE_URL}/rty/reinsert-rate/options`,
  ),
  dashboard: (query: ReinsertQuery) =>
    requestData<ReinsertDashboard>(`${API_BASE_URL}/rty/reinsert-rate?${params(query)}`),
  details: (query: DetailQuery, page = 1, pageSize = 50) => {
    const qs = params(query);
    qs.set('page', String(page));
    qs.set('pageSize', String(pageSize));
    return requestData<DetailResult>(`${API_BASE_URL}/rty/reinsert-rate/details?${qs}`);
  },
};
