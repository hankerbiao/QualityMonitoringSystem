import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { operationsApi } from './api/operationsApi';
import { LoadingPage } from './components/ui';
import { ModelTargetsProvider } from './context/ModelTargetsContext';
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

function AppContent() {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<LoadingPage />}>
        <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/alert-report/:token" element={<AlertReportPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/rty" element={<RTYPage />} />
          <Route path="/station-pass-rate" element={<StationPassRatePage />} />
          <Route path="/lrr" element={<LRRPage />} />
          <Route path="/process-records" element={<ProcessRecordsPage />} />
          <Route path="/operations" element={<OperationsPage />} />
          <Route path="/doa/raw" element={<DoaScsPage />} />
          <Route path="/doa" element={<DoaPage />} />
          <Route path="/doa/repairs" element={<DoaRepairsPage />} />
          <Route path="/mfr" element={<MFRPage />} />
          <Route path="/metadata/:tableName" element={<MetadataTablePage />} />
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
          <ModelTargetsProvider>
            <AppContent />
          </ModelTargetsProvider>
        </SettingsProvider>
      </AuthProvider>
    </Router>
  );
}
