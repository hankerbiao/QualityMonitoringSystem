import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getCurrentUser,
  loginWithPassword,
  registerUnauthorizedHandler,
  setAccessToken,
  setRefreshToken,
  clearTokens,
  getAccessToken,
} from '../api/authApi';
import type { UserProfile, AuthContextType } from '../types';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function InnerAuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isAuthLoaded, setIsAuthLoaded] = useState(false);

  const showLoginSuccess = useCallback((name?: string) => {
    const el = document.createElement('div');
    el.textContent = name ? `欢迎回来，${name}` : '登录成功';
    Object.assign(el.style, {
      position: 'fixed',
      top: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '9999',
      padding: '10px 24px',
      background: '#dcfce7',
      color: '#166534',
      border: '1px solid #bbf7d0',
      borderRadius: '9999px',
      fontSize: '14px',
      fontWeight: '500',
      boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
      animation: 'slideDown 0.3s ease-out',
    });
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.4s ease-out';
      setTimeout(() => el.remove(), 400);
    }, 2000);
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  useEffect(() => {
    registerUnauthorizedHandler(logout);
  }, [logout]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await loginWithPassword(username, password);
    if (!result.access_token || !result.refresh_token || !result.user) {
      throw new Error('登录响应不完整，请稍后重试');
    }

    setAccessToken(result.access_token, result.expires_in ?? 900);
    setRefreshToken(result.refresh_token);
    const profile = result.user as UserProfile;
    setUser(profile);
    showLoginSuccess(profile.姓名 || profile.真实姓名 || profile.name);
    navigate('/', { replace: true });
  }, [navigate, showLoginSuccess]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setUser(null);
      setIsAuthLoaded(true);
      return;
    }
    getCurrentUser()
      .then((current) => setUser(current.user as UserProfile))
      .catch(() => {
        clearTokens();
        setUser(null);
      })
      .finally(() => setIsAuthLoaded(true));
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isAuthLoaded, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return <InnerAuthProvider>{children}</InnerAuthProvider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
