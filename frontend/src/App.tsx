import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Home from './pages/Home';
import RTYPage from './pages/RTYPage';
import LRRPage from './pages/LRRPage';
import LoginPage from './pages/LoginPage';
import AlertReportPage from './pages/AlertReportPage';
import { ModelTargetsProvider } from './context/ModelTargetsContext';
import { SettingsProvider } from './context/SettingsContext';
import { AuthProvider, useAuth } from './context/AuthContext';

function ProtectedLayout() {
  const { isAuthenticated, isAuthLoaded } = useAuth();
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
        <Route path="/doa" element={<Navigate to="/" />} />
        <Route path="/mfr" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <ModelTargetsProvider>
          <SettingsProvider>
            <AppContent />
          </SettingsProvider>
        </ModelTargetsProvider>
      </AuthProvider>
    </Router>
  );
}