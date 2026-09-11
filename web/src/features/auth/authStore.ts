import { create } from 'zustand';

export type Role = 'ADMIN' | 'PROJECT_MANAGER' | 'DEVELOPER';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** 'checking' until the first session restore settles, so a reload doesn't flash the login page. */
export type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** In memory only, never localStorage: a reload gets a fresh one via the HttpOnly refresh cookie. */
  accessToken: string | null;
  setSession: (user: AuthUser, accessToken: string) => void;
  clearSession: () => void;
}

// A Zustand store rather than React context, because the Axios interceptor and the socket hook
// (outside React's render cycle) need to read the token and end the session.
export const useAuthStore = create<AuthState>()((set) => ({
  status: 'checking',
  user: null,
  accessToken: null,
  setSession: (user, accessToken) => set({ status: 'authenticated', user, accessToken }),
  clearSession: () => set({ status: 'anonymous', user: null, accessToken: null }),
}));
