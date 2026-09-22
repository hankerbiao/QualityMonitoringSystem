import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { operationsApi } from './api/operationsApi';
import { LoadingPage } from './components/ui';
import { SettingsProvider } from './context/SettingsContext';
import { AuthProvider, useAuth } from './context/AuthContext';

const Home = lazy(() => import('./pages/Home'));
const RTYPage = lazy(() => import('./pages/RTYPage'));
const StationPassRatePage = lazy(() => import('./pages/StationPassRatePage'));
const LRRPage = lazy(() => import('./pages/LRRPage'));
const ProcessRecordsPage = lazy(() => import('./pages/ProcessRecordsPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const AlertReportPage = lazy(() => import('./pages/AlertReportPage'));
const OperationsPage = lazy(() => import('./pages/OperationsPage'));
const DoaScsPage = lazy(() => import('./pages/DoaScsPage'));
const DoaPage = lazy(() => import('./pages/DoaPage'));
const DoaRepairsPage = lazy(() => import('./pages/DoaRepairsPage'));
const MFRPage = lazy(() => import('./pages/MFRPage'));
const MetadataTablePage = lazy(() => import('./pages/MetadataTablePage'));

class RouteErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Route module failed to load', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="text-center">
            <p className="text-sm text-slate-600">页面加载失败</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-3 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              重新加载
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

function ProtectedLayout() {
  const { isAuthenticated, isAuthLoaded } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!isAuthLoaded || !isAuthenticated) return;
    operationsApi.trackPageView(location.pathname).catch((error) => {
      console.debug('Page view tracking skipped', error);
    });
  }, [isAuthLoaded, isAuthenticated, location.pathname]);

  if (!isAuthLoaded) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function DashboardAccess({ permission, children }: { permission: string; children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'admin' && !user?.dashboardPermissions?.includes(permission)) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-slate-900">暂无访问权限</h1>
          <p className="mt-2 text-sm text-slate-500">当前账号未开通此看板，请联系管理员配置权限。</p>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}

function AppContent() {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<LoadingPage />}>
        <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/alert-report/:token" element={<AlertReportPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/rty" element={<DashboardAccess permission="rty"><RTYPage /></DashboardAccess>} />
          <Route path="/station-pass-rate" element={<DashboardAccess permission="station-pass-rate"><StationPassRatePage /></DashboardAccess>} />
          <Route path="/lrr" element={<DashboardAccess permission="lrr"><LRRPage /></DashboardAccess>} />
          <Route path="/process-records" element={<DashboardAccess permission="process-records"><ProcessRecordsPage /></DashboardAccess>} />
          <Route path="/operations" element={<DashboardAccess permission="admin"><OperationsPage /></DashboardAccess>} />
          <Route path="/doa/raw" element={<DashboardAccess permission="doa"><DoaScsPage /></DashboardAccess>} />
          <Route path="/doa" element={<DashboardAccess permission="doa"><DoaPage /></DashboardAccess>} />
          <Route path="/doa/repairs" element={<DashboardAccess permission="doa-repairs"><DoaRepairsPage /></DashboardAccess>} />
          <Route path="/mfr" element={<DashboardAccess permission="mfr"><MFRPage /></DashboardAccess>} />
          <Route path="/metadata/:tableName" element={<DashboardAccess permission="metadata"><MetadataTablePage /></DashboardAccess>} />
        </Route>
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <SettingsProvider>
          <AppContent />
        </SettingsProvider>
      </AuthProvider>
    </Router>
  );
}
