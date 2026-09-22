import { API_BASE_URL } from '../constants';
import { requestJson } from './authApi';

export interface ManagedUser {
  username: string;
  displayName: string;
  role: 'user' | 'admin';
  isActive: boolean;
  dashboardPermissions: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CreateManagedUser {
  username: string;
  displayName: string;
  password: string;
  dashboardPermissions: string[];
}

export const adminUsersApi = {
  list: () => requestJson<ManagedUser[]>(`${API_BASE_URL}/admin/users`),
  create: (payload: CreateManagedUser) => requestJson<ManagedUser>(`${API_BASE_URL}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  update: (username: string, payload: Partial<Pick<ManagedUser, 'displayName' | 'isActive' | 'dashboardPermissions'>>) => requestJson<ManagedUser>(`${API_BASE_URL}/admin/users/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  resetPassword: (username: string, password: string) => requestJson<ManagedUser>(`${API_BASE_URL}/admin/users/${encodeURIComponent(username)}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  }),
};
