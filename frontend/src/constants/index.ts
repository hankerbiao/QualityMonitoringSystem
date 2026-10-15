export function getAppBasePath(pathname = window.location.pathname): string {
  return pathname === '/QualiBoard' || pathname.startsWith('/QualiBoard/')
    ? '/QualiBoard'
    : '';
}

export const API_BASE_URL = `${getAppBasePath()}/api`;

export const TOKEN_KEYS = {
  ACCESS: 'qualiboard-access-token',
  REFRESH: 'qualiboard-session-token',
  EXPIRY: 'qualiboard-token-expiry',
} as const;
