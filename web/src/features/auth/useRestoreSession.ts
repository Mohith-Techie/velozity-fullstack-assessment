import { useEffect } from 'react';
import { refreshAccessToken } from '../../api/axios';

/** On first load, trades the HttpOnly refresh cookie (if there is one) for an access token. */
export function useRestoreSession(): void {
  useEffect(() => {
    refreshAccessToken().catch(() => {
      // No valid session: the store is now 'anonymous', and ProtectedRoute sends the user to /login.
    });
  }, []);
}
