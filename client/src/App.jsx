import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';

// Routing grows phase by phase. Phase 0 ships a single health-check landing page.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
