/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import RTYPage from './pages/RTYPage';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/rty" element={<RTYPage />} />
        {/* Mock other routes pointing back to home or a placeholder */}
        <Route path="/lrr" element={<Navigate to="/" />} />
        <Route path="/doa" element={<Navigate to="/" />} />
        <Route path="/mfr" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}
