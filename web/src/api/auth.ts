import { useAuthStore, type AuthUser } from '../features/auth/authStore';
import { authClient, type TokenResponse } from './axios';

/** Signs in; the server sets the refresh cookie, and the access token goes into the in-memory store. */
export async function login(email: string, password: string): Promise<AuthUser> {
  const { data } = await authClient.post<TokenResponse>('/auth/login', { email, password });
  useAuthStore.getState().setSession(data.user, data.accessToken);
  return data.user;
}

/** Revokes the session server-side (and clears the cookie), then forgets it locally even if that call fails. */
export async function logout(): Promise<void> {
  try {
    await authClient.post('/auth/logout');
  } finally {
    useAuthStore.getState().clearSession();
  }
}
