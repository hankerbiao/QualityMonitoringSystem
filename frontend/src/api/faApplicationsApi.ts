import { API_BASE_URL } from '../constants';
import { requestJson } from './authApi';
import type { FAApplication, FAPreview, FAPreviewRequest } from '../types/faApplications';

export interface FACreateRequest extends FAPreviewRequest {
  selectedRepairIds: string[];
  selectedDoaIds: string[];
}

export interface FASubmitRequest {
  application: FACreateRequest;
  email: { to: string[]; cc: string[]; subject: string; content: string };
}

export interface FAApplicationList {
  items: FAApplication[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FAListParams {
  page?: number;
  pageSize?: number;
  pn?: string;
  creator?: string;
  emailStatus?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface OAEmployee {
  itcode: string;
  realname: string;
  internalName: string;
  email: string;
  department: string;
  position: string;
  company: string;
  directBoss: string;
}

export const faApplicationsApi = {
  listEmployees: () => requestJson<{ items: OAEmployee[] }>(`${API_BASE_URL}/fa/employees`),
  preview: (query: FAPreviewRequest) => requestJson<FAPreview>(`${API_BASE_URL}/fa/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  }),
  submit: (request: FASubmitRequest) => requestJson<FAApplication>(`${API_BASE_URL}/fa/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  }),
  list: (params: FAListParams = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && String(value) !== '') query.set(key, String(value));
    }
    return requestJson<FAApplicationList>(`${API_BASE_URL}/fa/applications?${query.toString()}`);
  },
};
