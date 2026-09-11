import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore, type AuthUser } from '../features/auth/authStore';

export interface TokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: AuthUser;
}

/** For the auth endpoints themselves. No interceptors, so a failing refresh can never trigger another refresh. */
export const authClient = axios.create({ baseURL: '/api', withCredentials: true });

/** For every other API call: attaches the access token and, on a 401, refreshes it once and retries. */
export const api = axios.create({ baseURL: '/api', withCredentials: true });

let refreshInFlight: Promise<string> | null = null;

/**
 * Trades the HttpOnly refresh cookie (which the browser sends by itself) for a new access token.
 * Single-flight: concurrent callers share one request. The server rotates the refresh token on every use and
 * treats a second use of the same token as theft, so two parallel refreshes would end the session.
 * If the refresh fails, the local session is cleared, which logs the user out.
 */
export function refreshAccessToken(): Promise<string> {
  refreshInFlight ??= authClient
    .post<TokenResponse>('/auth/refresh')
    .then(({ data }) => {
      useAuthStore.getState().setSession(data.user, data.accessToken);
      return data.accessToken;
    })
    .catch((error: unknown) => {
      useAuthStore.getState().clearSession();
      throw error;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

api.interceptors.response.use(undefined, async (error: unknown) => {
  if (!(error instanceof AxiosError) || error.response?.status !== 401) throw error;
  const original = error.config as RetriableConfig | undefined;
  // At most one refresh-and-retry per request, so a request that keeps getting 401s can't loop.
  if (!original || original._retry) throw error;
  original._retry = true;

  try {
    await refreshAccessToken();
  } catch {
    throw error; // the session is over (and now cleared); surface the original 401 to the caller
  }
  return api(original); // the request interceptor attaches the new token
});
