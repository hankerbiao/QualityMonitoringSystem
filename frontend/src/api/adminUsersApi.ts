import { API_BASE_URL } from '../constants';
import { requestJson } from './authApi';

export interface ManagedUser {
  username: string;
  displayName: string;
  role: 'user' | 'admin';
  isActive: boolean;
  isProtected: boolean;
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

export interface UpdateManagedUser {
  role?: 'user' | 'admin';
  displayName?: string;
  isActive?: boolean;
  dashboardPermissions?: string[];
  password?: string;
}

export const adminUsersApi = {
  list: () => requestJson<ManagedUser[]>(`${API_BASE_URL}/admin/users`),
  create: (payload: CreateManagedUser) => requestJson<ManagedUser>(`${API_BASE_URL}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  update: (username: string, payload: UpdateManagedUser) => requestJson<ManagedUser>(`${API_BASE_URL}/admin/users/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  remove: (username: string) => requestJson<void>(`${API_BASE_URL}/admin/users/${encodeURIComponent(username)}`, {
    method: 'DELETE',
  }),
};
