import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import RTYPage from './pages/RTYPage';
import LRRPage from './pages/LRRPage';
import ProcessRecordsPage from './pages/ProcessRecordsPage';
import LoginPage from './pages/LoginPage';
import AlertReportPage from './pages/AlertReportPage';
import OperationsPage from './pages/OperationsPage';
import DoaScsPage from './pages/DoaScsPage';
import DoaPage from './pages/DoaPage';
import DoaReplacementPage from './pages/DoaReplacementPage';
import DoaRepairsPage from './pages/DoaRepairsPage';
import SalesOrdersPage from './pages/SalesOrdersPage';
import MFRPage from './pages/MFRPage';
import MetadataTablePage from './pages/MetadataTablePage';
import { operationsApi } from './api/operationsApi';
import { ModelTargetsProvider } from './context/ModelTargetsContext';
import { SettingsProvider } from './context/SettingsContext';
import { AuthProvider, useAuth } from './context/AuthContext';

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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/alert-report/:token" element={<AlertReportPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/rty" element={<RTYPage />} />
        <Route path="/lrr" element={<LRRPage />} />
        <Route path="/process-records" element={<ProcessRecordsPage />} />
        <Route path="/operations" element={<OperationsPage />} />
        <Route path="/doa/raw" element={<DoaScsPage />} />
        <Route path="/doa" element={<DoaPage />} />
        <Route path="/doa/replacement" element={<DoaReplacementPage />} />
        <Route path="/doa/repairs" element={<DoaRepairsPage />} />
        <Route path="/sales-orders" element={<SalesOrdersPage />} />
        <Route path="/mfr" element={<MFRPage />} />
        <Route path="/metadata/:tableName" element={<MetadataTablePage />} />
      </Route>
    </Routes>
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
