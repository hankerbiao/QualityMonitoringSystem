// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('deployment entry paths', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.resetModules();
  });

  it.each(['/', '/QualiBoard', '/QualiBoard/', '/QualiBoard/rty', '/QualiBoard-other'])(
    'keeps all API requests under the entry prefix for %s',
    async (entry) => {
      window.history.replaceState({}, '', entry);
      vi.resetModules();
      const fetchMock = vi.fn().mockImplementation(async (input: string) => {
        if (input.endsWith('/auth/refresh')) {
          return Response.json({ access_token: 'renewed-token', expires_in: 900 });
        }
        return Response.json({ success: true, data: [], ok: true });
      });
      vi.stubGlobal('fetch', fetchMock);

      const auth = await import('./authApi');
      const { rtyApi } = await import('./rtyApi');
      const { lrrApi } = await import('./lrrApi');
      const { doaApi } = await import('./doaApi');
      const { mfrApi } = await import('./mfrApi');
      const { operationsApi } = await import('./operationsApi');
      const { settingsApi } = await import('./settingsApi');
      const { processRecordsApi } = await import('./processRecordsApi');
      const { alertReportApi } = await import('./alertReport');

      auth.setAccessToken('test-token', 3600);
      auth.setRefreshToken('refresh-token');
      await auth.loginWithPassword('test-user', 'test-password');
      await auth.getCurrentUser();
      await rtyApi.getStationPassRates({ groupBy: 'productModel' });
      await lrrApi.getOptions();
      await doaApi.getOptions();
      await mfrApi.getDashboard({ dateFrom: '2026-10-01', dateTo: '2026-10-15' });
      await operationsApi.getDashboard(7);
      await settingsApi.getDashboardStatuses();
      await processRecordsApi.getFilterOptions();
      await alertReportApi.getReport('public-token');
      auth.setAccessToken('expired-token', 0);
      await auth.getCurrentUser();

      const prefix = entry === '/QualiBoard' || entry.startsWith('/QualiBoard/') ? '/QualiBoard' : '';
      const paths = fetchMock.mock.calls.map(([input]) => new URL(input, window.location.origin).pathname);
      expect(paths).toEqual([
        '/auth/login', '/auth/me', '/rty/station-pass-rates', '/lrr/options',
        '/doa/options', '/mfr/dashboard', '/operations/dashboard',
        '/settings/dashboard-statuses', '/process-records/filter-options',
        '/alert-report/public-token', '/auth/refresh', '/auth/me',
      ].map((path) => `${prefix}/api${path}`));
      expect(processRecordsApi.imageUrl('system1', '/photo.jpg')).toBe(
        `${prefix}/api/process-records/image?source=system1&path=%2Fphoto.jpg`,
      );
    },
  );
});
