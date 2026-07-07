/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import RTYPage from './pages/RTYPage';
import AIAssistant from './components/AIAssistant';
import { ModelTargetsProvider } from './context/ModelTargetsContext';
import { SettingsProvider } from './context/SettingsContext';

function AppContent() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/rty" element={<RTYPage />} />
        <Route path="/lrr" element={<Navigate to="/" />} />
        <Route path="/doa" element={<Navigate to="/" />} />
        <Route path="/mfr" element={<Navigate to="/" />} />
      </Routes>
      <AIAssistant />
    </>
  );
}

export default function App() {
  return (
    <ModelTargetsProvider>
      <SettingsProvider>
        <Router>
          <AppContent />
        </Router>
      </SettingsProvider>
    </ModelTargetsProvider>
  );
}
