import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setAuthToken, setUnauthorizedHandler } from '../lib/api';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

interface AuthContextType {
  user: AuthUser;
  logout: () => Promise<void>;
  setUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Estado de login para o portão do app (login / definir senha / sistema) */
export function useAuthState() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined); // undefined = verificando
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    api
      .get<{ user: AuthUser }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setExpired(true);
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signedIn = useCallback((u: AuthUser) => {
    setExpired(false);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setAuthToken(null);
    setExpired(false);
    setUser(null);
  }, []);

  return { user, expired, signedIn, logout, setUser };
}

export const AuthProvider: React.FC<{ value: AuthContextType; children: React.ReactNode }> = ({ value, children }) => (
  <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
