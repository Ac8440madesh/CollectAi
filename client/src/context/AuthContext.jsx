import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api, { getToken, setToken } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setTokenState] = useState(() => getToken());
  // Only "loading" if we have a token to verify on first paint.
  const [loading, setLoading] = useState(Boolean(getToken()));

  // On load (or token change), confirm the token and fetch the current user.
  useEffect(() => {
    let active = true;
    if (!token) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    api
      .get('/auth/me')
      .then((res) => {
        if (active) setUser(res.data.user);
      })
      .catch(() => {
        // Token invalid/expired — clear it.
        if (active) {
          setToken(null);
          setTokenState(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const applyAuth = useCallback((data) => {
    setToken(data.token);
    setTokenState(data.token);
    setUser(data.user);
  }, []);

  const login = useCallback(
    async (email, password) => {
      const res = await api.post('/auth/login', { email, password });
      applyAuth(res.data);
    },
    [applyAuth],
  );

  const register = useCallback(
    async (payload) => {
      const res = await api.post('/auth/register', payload);
      applyAuth(res.data);
    },
    [applyAuth],
  );

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
