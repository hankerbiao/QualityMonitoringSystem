import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getCurrentUser,
  registerUnauthorizedHandler,
  submitOALogin,
  setAccessToken,
  setRefreshToken,
  clearTokens,
  getAccessToken,
} from '../api/authApi';
import { OA_LOGIN_BASE_URL, OA_APP_NAME } from '../constants';
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

  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get('status');
    const payload = url.searchParams.get('payload');
    const accessToken = url.searchParams.get('access_token');
    const refreshToken = url.searchParams.get('refresh_token');
    const expiresIn = url.searchParams.get('expires_in');

    if (!status) return;

    url.searchParams.delete('status');
    url.searchParams.delete('payload');
    url.searchParams.delete('access_token');
    url.searchParams.delete('refresh_token');
    url.searchParams.delete('expires_in');
    url.searchParams.delete('next');
    window.history.replaceState(null, '', url.toString());

    if (payload) {
      setUser({ itcode: 'logging_in' });
      submitOALogin({ status, payload, next: null })
        .then(async (result) => {
          if (result.access_token && result.refresh_token) {
            setAccessToken(result.access_token, result.expires_in ?? 900);
            setRefreshToken(result.refresh_token);
            const current = await getCurrentUser();
            setUser(current.user as UserProfile);
            showLoginSuccess((current.user as UserProfile)?.姓名 || (current.user as UserProfile)?.真实姓名);
            navigate('/', { replace: true });
          } else {
            throw new Error('No token in response');
          }
        })
        .catch((err) => {
          console.error('OA login failed', err);
          clearTokens();
          setUser(null);
        });
    } else if (accessToken && refreshToken) {
      const exp = expiresIn ? parseInt(expiresIn, 10) : 900;
      setAccessToken(accessToken, exp);
      setRefreshToken(refreshToken);
      setUser({ itcode: 'logging_in' });
      getCurrentUser()
        .then((current) => {
          setUser(current.user as UserProfile);
          showLoginSuccess((current.user as UserProfile)?.姓名 || (current.user as UserProfile)?.真实姓名);
          navigate('/', { replace: true });
        })
        .catch((err) => {
          console.error('OA login failed', err);
          clearTokens();
          setUser(null);
        });
    }
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
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isAuthLoaded, logout }}>
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

export function getOALoginUrl(): string {
  const next = window.location.origin;
  return `${OA_LOGIN_BASE_URL}/${encodeURIComponent(OA_APP_NAME)}?next=${encodeURIComponent(next)}`;
}