import { API_BASE_URL, TOKEN_KEYS } from '../constants';

const REFRESH_TOKEN_KEY = 'qualiboard-session-token';

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEYS.ACCESS);
  } catch {
    return null;
  }
}

export function setAccessToken(token: string, expiresIn: number) {
  try {
    localStorage.setItem(TOKEN_KEYS.ACCESS, token);
    const expiry = Date.now() + expiresIn * 1000;
    localStorage.setItem(TOKEN_KEYS.EXPIRY, String(expiry));
  } catch {
    // ignore
  }
}

export function getTokenExpiry(): number | null {
  try {
    const expiry = localStorage.getItem(TOKEN_KEYS.EXPIRY);
    return expiry ? parseInt(expiry, 10) : null;
  } catch {
    return null;
  }
}

export function isTokenExpiringSoon(soonMs = 60_000): boolean {
  const expiry = getTokenExpiry();
  if (!expiry) return true;
  return Date.now() >= expiry - soonMs;
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string) {
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export function clearTokens() {
  try {
    localStorage.removeItem(TOKEN_KEYS.ACCESS);
    localStorage.removeItem(TOKEN_KEYS.EXPIRY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler = () => {};

export function registerUnauthorizedHandler(handler: UnauthorizedHandler) {
  unauthorizedHandler = handler;
}

let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

async function refreshAccessToken(): Promise<string | null> {
  if (isRefreshing) {
    return new Promise((resolve) => {
      refreshQueue.push(resolve);
    });
  }

  isRefreshing = true;
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    isRefreshing = false;
    unauthorizedHandler();
    return null;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      throw new Error('Refresh failed');
    }

    const data = await response.json();
    const newAccessToken = data.access_token;
    const expiresIn = data.expires_in;

    setAccessToken(newAccessToken, expiresIn);

    refreshQueue.forEach((resolve) => resolve(newAccessToken));
    refreshQueue = [];

    return newAccessToken;
  } catch {
    refreshQueue.forEach(() => unauthorizedHandler());
    refreshQueue = [];
    unauthorizedHandler();
    return null;
  } finally {
    isRefreshing = false;
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let token = getAccessToken();

  if (!token || isTokenExpiringSoon()) {
    token = await refreshAccessToken();
    if (!token) {
      throw new Error('UNAUTHORIZED');
    }
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    unauthorizedHandler();
    throw new Error('UNAUTHORIZED');
  }

  return response;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  detail?: string;
}

/** Parse an authenticated JSON response and normalize HTTP errors. */
export async function requestJson<T>(input: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(input, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error || payload?.detail || payload?.message;
    throw new Error(message || `请求失败 (${response.status})`);
  }
  return payload as T;
}

/** Parse the common { success, data } API response used by dashboard endpoints. */
export async function requestData<T>(input: string, init: RequestInit = {}): Promise<T> {
  const payload = await requestJson<ApiEnvelope<T>>(input, init);
  if (!payload?.success || payload.data === undefined) {
    throw new Error(payload?.error || payload?.message || '请求返回数据无效');
  }
  return payload.data;
}

export async function getCurrentUser(): Promise<{
  itcode: string;
  user: unknown;
}> {
  const response = await apiFetch(`${API_BASE_URL}/auth/me`);

  if (!response.ok) {
    throw new Error('Failed to fetch current user');
  }

  return response.json();
}

interface LoginResponse {
  ok: boolean;
  user?: unknown;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export async function loginWithPassword(username: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = payload?.detail || payload?.error || '登录失败，请稍后重试';
    throw new Error(message);
  }

  return response.json();
}

export async function submitOALogin(params: {
  status: string;
  payload: string;
  next: string | null;
}): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/oa/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = payload?.detail || payload?.error || 'OA 登录失败，请稍后重试';
    throw new Error(message);
  }

  return response.json();
}
