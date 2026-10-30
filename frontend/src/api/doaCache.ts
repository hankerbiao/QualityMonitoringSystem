import { API_BASE_URL } from '../constants';
import type { DoaDashboard, DoaFilters, DoaOptions } from '../types/doa';

const STORAGE_KEY = 'qualiboard:doa-cache:v2';
const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ENTRIES = 20;
type Entry = { key: string; expiresAt: number; data: unknown };

function entries(): Entry[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item): item is Entry =>
      item && typeof item.key === 'string' && typeof item.expiresAt === 'number' && item.expiresAt > Date.now()) : [];
  } catch { return []; }
}

function read<T>(key: string): T | null {
  return (entries().find(item => item.key === key)?.data as T | undefined) ?? null;
}

function write(key: string, data: unknown, expiresAt: number): void {
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
  try {
    const items = entries().filter(item => item.key !== key);
    items.push({ key, data, expiresAt: Math.min(expiresAt, Date.now() + TTL_MS) });
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-MAX_ENTRIES)));
  } catch { /* Storage may be unavailable or full; continue without caching. */ }
}

function filterKey(filters: DoaFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters).sort(([a], [b]) => a.localeCompare(b))) {
    if (Array.isArray(value)) [...new Set(value)].sort().forEach(item => params.append(key, item));
    else if (value !== '' && value !== null && value !== undefined) params.set(key, String(value));
  }
  return params.toString();
}

function key(scope: string, suffix: string): string { return JSON.stringify([API_BASE_URL, scope, suffix]); }

export function clearDoaCache(): void {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
}

export function readDoaCache(scope: string, filters: DoaFilters): DoaDashboard | null {
  return scope ? read<DoaDashboard>(key(scope, `dashboard:${filterKey(filters)}`)) : null;
}

export function writeDoaCache(scope: string, filters: DoaFilters, data: DoaDashboard): void {
  if (scope && data.cacheExpiresAt) write(key(scope, `dashboard:${filterKey(filters)}`), data, Date.parse(data.cacheExpiresAt));
}

export function readDoaOptionsCache(scope: string): DoaOptions | null {
  return scope ? read<DoaOptions>(key(scope, 'options')) : null;
}

export function writeDoaOptionsCache(scope: string, data: DoaOptions): void {
  if (scope) write(key(scope, 'options'), data, Date.now() + TTL_MS);
}
