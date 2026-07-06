/* eslint-disable react-refresh/only-export-components */
import { createContext, useState, useEffect, useCallback } from 'react';
import api from '../api/client';

export const AuthContext = createContext();

const initialStatus = {
  loading: true,
  isAuthenticated: false,
  needsSetup: false,
  username: null,
  role: null,
};

export function AuthProvider({ children }) {
  const [status, setStatus] = useState(initialStatus);

  const refresh = useCallback(() => (
    api.get('/auth/status')
      .then(res => setStatus({ ...res.data, loading: false }))
      .catch(() => setStatus({ ...initialStatus, loading: false }))
  ), []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    await refresh();
    return res.data;
  };

  const setup = async (username, password) => {
    const res = await api.post('/auth/setup', { username, password });
    await refresh();
    return res.data;
  };

  const logout = async () => {
    await api.post('/auth/logout');
    await refresh();
  };

  const value = {
    ...status,
    isAdmin: status.role === 'Admin',
    login,
    setup,
    logout,
    refresh,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
