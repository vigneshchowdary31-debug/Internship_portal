import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

export type User = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'INSTRUCTOR' | 'STUDENT';
  /**
   * True while the user still owes the one-time password change.
   * Mirrored from the server on every `/auth/me`; the server enforces the same
   * rule independently, so tampering with it client-side gains nothing.
   */
  mustChangePassword?: boolean;
};

type AuthContextType = {
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  /** Merges fields into the cached user, e.g. after a successful password change. */
  updateUser: (patch: Partial<User>) => void;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          // `/auth/me` is the single source of truth on refresh — it returns
          // name, email, role and mustChangePassword, so nothing about the
          // session is reconstructed from stale localStorage.
          const res = await api.get('/auth/me');
          setUser(res.data.data.user);
        } catch {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      }
      setIsLoading(false);
    };
    initAuth();
  }, []);

  const login = useCallback((token: string, userData: User) => {
    localStorage.setItem('token', token);
    setUser(userData);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  }, []);

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((current) => (current ? { ...current, ...patch } : current));
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

/** Landing route for a role, used after login and after a password change. */
export function homePathFor(role: User['role']): string {
  if (role === 'ADMIN') return '/admin';
  if (role === 'INSTRUCTOR') return '/instructor';
  return '/student';
}
