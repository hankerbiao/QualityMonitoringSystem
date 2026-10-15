// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestData } from './authApi';
import { clearRtyApiCache, rtyApi } from './rtyApi';

vi.mock('./authApi', () => ({ requestData: vi.fn(), requestJson: vi.fn() }));

const HOUR = 60 * 60 * 1_000;
const now = new Date('2026-10-15T13:56:21+08:00').getTime();
const options = { dateFrom: '2026-10-05', dateTo: '2026-10-11' };
const storageKey = 'qualiboard:rty-cycle-data:v2:cycle-data:normal::2026-10-05:2026-10-11';

describe('RTY cycle cache lifetime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    clearRtyApiCache();
    window.localStorage.clear();
    vi.mocked(requestData).mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    clearRtyApiCache();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it('reuses cycle data for one hour and fetches again at the expiry boundary', async () => {
    expect(await rtyApi.getCycleData('normal', undefined, options)).toMatchObject({
      cached: false, cachedAt: now,
    });
    const stored = JSON.parse(window.localStorage.getItem(storageKey)!);
    expect(stored.expiresAt - stored.cachedAt).toBe(HOUR);

    vi.setSystemTime(now + HOUR - 1);
    expect(await rtyApi.getCycleData('normal', undefined, options)).toMatchObject({
      cached: true, cachedAt: now,
    });
    expect(requestData).toHaveBeenCalledTimes(1);

    vi.setSystemTime(now + HOUR);
    expect(await rtyApi.getCycleData('normal', undefined, options)).toMatchObject({
      cached: false, cachedAt: now + HOUR,
    });
    expect(requestData).toHaveBeenCalledTimes(2);
  });

  it('keeps the original expiry when cycle data is restored after a page reload', async () => {
    await rtyApi.getCycleData('normal', undefined, options);
    clearRtyApiCache();
    vi.setSystemTime(now + HOUR / 2);

    expect(await rtyApi.getCycleData('normal', undefined, options)).toMatchObject({
      cached: true, cachedAt: now,
    });
    expect(requestData).toHaveBeenCalledTimes(1);

    vi.setSystemTime(now + HOUR);
    await rtyApi.getCycleData('normal', undefined, options);
    expect(requestData).toHaveBeenCalledTimes(2);
  });

  it('rejects existing five-hour cache records that are already one hour old', async () => {
    window.localStorage.setItem(storageKey, JSON.stringify({
      data: [], cachedAt: now - HOUR, expiresAt: now + 4 * HOUR,
    }));

    expect(await rtyApi.getCycleData('normal', undefined, options)).toMatchObject({
      cached: false, cachedAt: now,
    });
    expect(requestData).toHaveBeenCalledTimes(1);
  });

  it('caps a recent five-hour cache record at one hour from its original creation', async () => {
    window.localStorage.setItem(storageKey, JSON.stringify({
      data: [], cachedAt: now - HOUR / 2, expiresAt: now + 4.5 * HOUR,
    }));

    expect(await rtyApi.getCycleData('normal', undefined, options)).toMatchObject({
      cached: true, cachedAt: now - HOUR / 2,
    });
    expect(requestData).not.toHaveBeenCalled();

    vi.setSystemTime(now + HOUR / 2);
    expect(await rtyApi.getCycleData('normal', undefined, options)).toMatchObject({
      cached: false, cachedAt: now + HOUR / 2,
    });
    expect(requestData).toHaveBeenCalledTimes(1);
  });

  it('allows the refresh button to bypass both caches before one hour elapses', async () => {
    await rtyApi.getCycleData('normal', undefined, options);
    vi.setSystemTime(now + 60_000);

    expect(await rtyApi.getCycleData('normal', undefined, { ...options, forceRefresh: true }))
      .toMatchObject({ cached: false, cachedAt: now + 60_000 });
    expect(requestData).toHaveBeenCalledTimes(2);
    expect(JSON.parse(window.localStorage.getItem(storageKey)!).cachedAt).toBe(now + 60_000);
  });
});
