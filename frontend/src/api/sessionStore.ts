// 会话存储抽象层。
//
// 当前: 存储 refresh_token (30天有效期)
// 后续可替换为 HttpOnly Cookie 方案，前端业务代码无需改动。

export interface SessionStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

const SESSION_STORAGE_KEY = 'qualiboard-session-token';

export class LocalStorageSessionStore implements SessionStore {
  get(): string | null {
    try {
      return localStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  set(token: string): void {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, token);
    } catch {
      // ignore（隐私模式 / 配额超限）
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

export const sessionStore: SessionStore = new LocalStorageSessionStore();
