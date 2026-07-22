import { API_BASE_URL, TOKEN_KEYS } from '../constants';
import { sessionStore } from './sessionStore';

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
  return sessionStore.get();
}

export function setRefreshToken(token: string) {
  sessionStore.set(token);
}

export function clearTokens() {
  try {
    localStorage.removeItem(TOKEN_KEYS.ACCESS);
    localStorage.removeItem(TOKEN_KEYS.EXPIRY);
    sessionStore.clear();
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
