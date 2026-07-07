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

interface UserProfile {
  itcode: string;
  [key: string]: string | undefined;
}

interface AuthContextType {
  user: UserProfile | null;
  isAuthenticated: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const OA_APP_NAME = 'buqualiboard';
const OA_LOGIN_BASE_URL = 'http://tl.cooacloud.com/springboard_v3/login_proxy';

function InnerAuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserProfile | null>(null);

  const finish = useCallback(
    (accessToken: string, refreshToken: string, expiresIn: number, userProfile?: UserProfile) => {
      setAccessToken(accessToken, expiresIn);
      setRefreshToken(refreshToken);
      setUser(userProfile ?? null);
      navigate('/', { replace: true });
    },
    [navigate]
  );

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
      submitOALogin({ status, payload, next: null })
        .then(async (result) => {
          if (result.access_token && result.refresh_token) {
            const current = await getCurrentUser();
            const profile = current.user as UserProfile;
            showLoginSuccess(profile.姓名 || profile.真实姓名);
            finish(result.access_token, result.refresh_token, result.expires_in ?? 900, profile);
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
      getCurrentUser()
        .then((current) => {
          const profile = current.user as UserProfile;
          showLoginSuccess(profile.姓名 || profile.真实姓名);
          finish(accessToken, refreshToken, exp, profile);
        })
        .catch((err) => {
          console.error('OA login failed', err);
          clearTokens();
          setUser(null);
        });
    }
  }, [finish, showLoginSuccess]);

  useEffect(() => {
    if (!getAccessToken()) return;
    getCurrentUser()
      .then((current) => setUser(current.user as UserProfile))
      .catch(() => {
        clearTokens();
        setUser(null);
      });
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, logout }}>
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