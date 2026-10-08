import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Guards a route: shows a loader while the token is being verified, redirects
 * to /login if unauthenticated, otherwise renders the page.
 */
export default function ProtectedRoute({ children }) {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>
    );
  }

  if (!token) return <Navigate to="/login" replace />;

  return children;
}
