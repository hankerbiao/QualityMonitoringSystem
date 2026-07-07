import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import Home from './pages/Home';
import RTYPage from './pages/RTYPage';
import LoginPage from './pages/LoginPage';
import { ModelTargetsProvider } from './context/ModelTargetsContext';
import { SettingsProvider } from './context/SettingsContext';
import { AuthProvider, useAuth } from './context/AuthContext';

function ProtectedLayout() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function AppContent() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/rty" element={<RTYPage />} />
        <Route path="/lrr" element={<Navigate to="/" />} />
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