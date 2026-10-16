// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changePassword, clearTokens, registerUnauthorizedHandler, setAccessToken } from './authApi';

describe('change password API', () => {
  const unauthorized = vi.fn();

  beforeEach(() => {
    clearTokens();
    setAccessToken('test-access-token', 900);
    registerUnauthorizedHandler(unauthorized);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    clearTokens();
    registerUnauthorizedHandler(() => {});
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('submits only the two passwords with the current authorization', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await changePassword('old-password', 'NewPassword123');
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/auth/change-password');
    expect(options?.method).toBe('POST');
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-access-token');
    expect(JSON.parse(options?.body as string)).toEqual({
      current_password: 'old-password', new_password: 'NewPassword123',
    });
  });

  it('reports an incorrect current password without treating it as an expired login', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ detail: '当前密码错误' }), { status: 400 }));
    await expect(changePassword('wrong', 'NewPassword123')).rejects.toThrow('当前密码错误');
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('requires a fresh login if the session has expired', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(changePassword('old-password', 'NewPassword123')).rejects.toThrow('登录状态已过期');
    expect(unauthorized).toHaveBeenCalledOnce();
  });
});
